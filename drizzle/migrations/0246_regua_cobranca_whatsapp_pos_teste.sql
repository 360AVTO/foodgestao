-- 1) Canal WhatsApp na fila
ALTER TABLE public.billing_notifications DROP CONSTRAINT IF EXISTS billing_notifications_channel_chk;
ALTER TABLE public.billing_notifications
  ADD CONSTRAINT billing_notifications_channel_chk CHECK (channel IN ('email', 'whatsapp'));

-- 2) WhatsApp do responsável financeiro na conta de cobrança
ALTER TABLE public.billing_accounts ADD COLUMN IF NOT EXISTS whatsapp_cobranca text;
COMMENT ON COLUMN public.billing_accounts.whatsapp_cobranca IS 'WhatsApp do responsável financeiro (só dígitos, com 55). Recebe a régua junto com o dono.';

-- 3) Interruptor geral do WhatsApp na régua
CREATE TABLE IF NOT EXISTS public.billing_regua_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  whatsapp_ativo boolean NOT NULL DEFAULT false,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid
);
GRANT SELECT ON public.billing_regua_config TO authenticated;
GRANT ALL ON public.billing_regua_config TO service_role;
ALTER TABLE public.billing_regua_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin lê a configuração da régua"
  ON public.billing_regua_config FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role));
INSERT INTO public.billing_regua_config (id, whatsapp_ativo) VALUES (true, false) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.billing_regua_config_obter()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  SELECT c.whatsapp_ativo, c.atualizado_em, p.full_name INTO r
    FROM public.billing_regua_config c
    LEFT JOIN public.profiles p ON p.user_id = c.atualizado_por
   WHERE c.id;
  RETURN jsonb_build_object('whatsapp_ativo', coalesce(r.whatsapp_ativo, false),
    'atualizado_em', r.atualizado_em, 'atualizado_por', r.full_name);
END $$;

CREATE OR REPLACE FUNCTION public.billing_regua_whatsapp_definir(_ativo boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.billing_regua_config (id, whatsapp_ativo, atualizado_em, atualizado_por)
  VALUES (true, coalesce(_ativo, false), now(), auth.uid())
  ON CONFLICT (id) DO UPDATE SET whatsapp_ativo = EXCLUDED.whatsapp_ativo,
    atualizado_em = now(), atualizado_por = auth.uid();
  IF NOT coalesce(_ativo, false) THEN
    UPDATE public.billing_notifications
       SET status = 'cancelled', last_error = 'WhatsApp da régua desligado', updated_at = now()
     WHERE channel = 'whatsapp' AND status = 'pending';
  END IF;
  RETURN public.billing_regua_config_obter();
END $$;

-- 4) WhatsApp do financeiro: leitura e alteração pela empresa
CREATE OR REPLACE FUNCTION public.billing_v2_whatsapp_cobranca_obter(_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_acc uuid; v_wa text;
BEGIN
  IF NOT public.assinatura_pode_gerir(_company_id, 'consulta') THEN
    RAISE EXCEPTION 'Sem permissão para ver a assinatura desta empresa.' USING ERRCODE = '42501';
  END IF;
  SELECT billing_account_id INTO v_acc FROM public.billing_account_companies
   WHERE company_id = _company_id AND removed_at IS NULL LIMIT 1;
  IF v_acc IS NOT NULL THEN
    SELECT whatsapp_cobranca INTO v_wa FROM public.billing_accounts WHERE id = v_acc;
  END IF;
  RETURN jsonb_build_object('tem_conta', v_acc IS NOT NULL, 'whatsapp', v_wa,
    'pode_alterar', v_acc IS NOT NULL AND public.assinatura_pode_gerir(_company_id, 'alteracao'));
END $$;

CREATE OR REPLACE FUNCTION public.billing_v2_whatsapp_cobranca_definir(_company_id uuid, _whatsapp text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_acc uuid; v_antes text; v_novo text; v_ddd int;
BEGIN
  IF NOT public.assinatura_pode_gerir(_company_id, 'alteracao') THEN
    RAISE EXCEPTION 'Somente o dono ou quem gere a assinatura pode alterar o WhatsApp do financeiro.' USING ERRCODE = '42501';
  END IF;
  SELECT billing_account_id INTO v_acc FROM public.billing_account_companies
   WHERE company_id = _company_id AND removed_at IS NULL LIMIT 1;
  IF v_acc IS NULL THEN
    RAISE EXCEPTION 'Esta empresa ainda não tem conta de cobrança.' USING ERRCODE = 'P0001';
  END IF;

  v_novo := nullif(regexp_replace(coalesce(_whatsapp, ''), '\D', '', 'g'), '');
  IF v_novo IS NOT NULL THEN
    IF length(v_novo) IN (10, 11) THEN v_novo := '55' || v_novo; END IF;
    IF length(v_novo) NOT IN (12, 13) OR left(v_novo, 2) <> '55' THEN
      RAISE EXCEPTION 'WhatsApp inválido. Informe DDD e número, por exemplo (62) 99999-9999.' USING ERRCODE = 'P0001';
    END IF;
    v_ddd := substr(v_novo, 3, 2)::int;
    IF v_ddd < 11 OR v_ddd > 99 OR v_ddd % 10 = 0 THEN
      RAISE EXCEPTION 'DDD inválido. Confira o número com DDD.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT whatsapp_cobranca INTO v_antes FROM public.billing_accounts WHERE id = v_acc FOR UPDATE;
  IF v_antes IS NOT DISTINCT FROM v_novo THEN
    RETURN jsonb_build_object('ok', true, 'whatsapp', v_novo, 'alterado', false);
  END IF;
  UPDATE public.billing_accounts SET whatsapp_cobranca = v_novo, updated_at = now() WHERE id = v_acc;
  INSERT INTO public.billing_account_events (billing_account_id, tipo_evento, payload, actor_id)
  VALUES (v_acc, 'whatsapp_cobranca_alterado',
    jsonb_build_object('antes_final', right(v_antes, 4), 'depois_final', right(v_novo, 4), 'company_id', _company_id),
    auth.uid());
  RETURN jsonb_build_object('ok', true, 'whatsapp', v_novo, 'alterado', true);
END $$;

-- 5) Apuração da régua: dias no horário de Brasília e pós-teste D+1/D+4/D+8
CREATE OR REPLACE FUNCTION public.billing_dunning_scan()
 RETURNS TABLE(company_id uuid, subscription_id uuid, invoice_id uuid, stage text, dias integer, amount_cents integer, due_date date, expira_em date, owner_user_id uuid, company_name text, company_cnpj text, company_email text, payment_url text, modulo text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s record;
  v_company record;
  v_fat record;
  v_d integer;
  v_stage text;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  FOR s IN
    SELECT sub.* FROM (SELECT * FROM public.subscriptions WHERE asaas_env = 'production') sub
    WHERE (sub.is_exempt IS NOT TRUE OR (sub.exempt_until IS NOT NULL AND sub.exempt_until < now()))
      AND (sub.dunning_paused_until IS NULL OR sub.dunning_paused_until < now())
  LOOP
    SELECT c.id, c.name, c.cnpj, c.email, c.user_id INTO v_company
      FROM public.companies c
     WHERE (s.company_id IS NOT NULL AND c.id = s.company_id)
        OR (s.company_id IS NULL AND c.user_id = s.user_id AND c.is_active IS TRUE)
     ORDER BY c.created_at ASC LIMIT 1;
    IF v_company.id IS NULL THEN CONTINUE; END IF;

    v_stage := NULL; v_d := NULL; v_fat := NULL;

    IF s.status::text = 'grace' THEN
      IF s.grace_ends_at IS NOT NULL THEN
        v_d := (v_hoje - (s.grace_ends_at AT TIME ZONE 'America/Sao_Paulo')::date)::integer;
        v_stage := CASE v_d WHEN -3 THEN 'grace_d_menos_3' WHEN -1 THEN 'grace_d_menos_1' WHEN 0 THEN 'grace_d0' ELSE NULL END;
        IF v_stage IS NOT NULL THEN
          RETURN QUERY SELECT v_company.id, s.id, NULL::uuid, v_stage, v_d, NULL::integer,
            (s.grace_ends_at AT TIME ZONE 'America/Sao_Paulo')::date, NULL::date, v_company.user_id,
            v_company.name, v_company.cnpj, v_company.email, NULL::text, s.module;
        END IF;
      END IF;
      CONTINUE;
    END IF;

    IF s.status::text IN ('trialing', 'expired') THEN
      IF s.trial_ends_at IS NULL THEN CONTINUE; END IF;
      v_d := (v_hoje - (s.trial_ends_at AT TIME ZONE 'America/Sao_Paulo')::date)::integer;
      IF s.status::text = 'trialing' AND v_d IN (-2, 0) THEN
        v_stage := CASE v_d WHEN -2 THEN 'trial_d5' ELSE 'trial_d7' END;
      ELSIF v_d IN (1, 4, 8) THEN
        -- pós-teste: só quem ainda não contratou nada nesta empresa
        IF NOT EXISTS (
          SELECT 1 FROM public.subscriptions o
           WHERE o.asaas_env = 'production' AND o.id <> s.id
             AND o.status::text IN ('active', 'grace', 'past_due')
             AND (o.company_id = v_company.id OR (o.company_id IS NULL AND o.user_id = v_company.user_id))
        ) THEN
          v_stage := 'trial_pos_' || v_d::text;
        END IF;
      END IF;
      IF v_stage IS NOT NULL THEN
        RETURN QUERY SELECT v_company.id, s.id, NULL::uuid, v_stage, v_d, NULL::integer,
          (s.trial_ends_at AT TIME ZONE 'America/Sao_Paulo')::date, NULL::date,
          v_company.user_id, v_company.name, v_company.cnpj, v_company.email, NULL::text, s.module;
      END IF;
      CONTINUE;
    END IF;

    SELECT i.id, i.amount_cents, i.due_date, i.external_payment_url INTO v_fat
      FROM (SELECT * FROM public.invoices WHERE asaas_env = 'production') i
     WHERE i.subscription_id = s.id AND i.status IN ('open', 'overdue')
     ORDER BY i.due_date ASC LIMIT 1;
    IF v_fat.id IS NULL THEN CONTINUE; END IF;

    v_d := (v_hoje - v_fat.due_date)::integer;
    v_stage := CASE v_d
      WHEN -3 THEN 'd_menos_3' WHEN 0 THEN 'd_0' WHEN 1 THEN 'd_mais_1' WHEN 5 THEN 'd_mais_5'
      WHEN 8 THEN 'd_mais_8' WHEN 10 THEN 'd_mais_10' WHEN 11 THEN 'd_mais_11' WHEN 20 THEN 'd_mais_20'
      WHEN 28 THEN 'd_mais_28' WHEN 31 THEN 'd_mais_31' WHEN 60 THEN 'd_mais_60' WHEN 80 THEN 'd_mais_80'
      WHEN 90 THEN 'd_mais_90' ELSE NULL END;
    IF v_stage IS NULL THEN CONTINUE; END IF;

    RETURN QUERY SELECT v_company.id, s.id, v_fat.id, v_stage, v_d, v_fat.amount_cents, v_fat.due_date,
      (v_fat.due_date + 90)::date, v_company.user_id, v_company.name, v_company.cnpj, v_company.email,
      v_fat.external_payment_url, s.module;
  END LOOP;
END;
$function$;

-- 6) Histórico com canal (super admin)
CREATE OR REPLACE FUNCTION public.billing_regua_historico(_busca text DEFAULT NULL, _status text DEFAULT NULL, _canal text DEFAULT NULL, _limite integer DEFAULT 300)
RETURNS TABLE(id uuid, company_id uuid, empresa text, subscription_id uuid, invoice_id uuid, stage text, channel text, recipient text, status text, attempts integer, last_error text, provider_message_id text, scheduled_at timestamptz, sent_at timestamptz, created_at timestamptz, pausada_ate timestamptz, pausa_motivo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id, n.company_id, c.name, n.subscription_id, n.invoice_id, n.stage, n.channel,
         n.recipient, n.status, n.attempts, n.last_error, n.provider_message_id,
         n.scheduled_at, n.sent_at, n.created_at,
         s.dunning_paused_until, s.dunning_pause_reason
    FROM public.billing_notifications n
    LEFT JOIN public.companies c ON c.id = n.company_id
    LEFT JOIN (SELECT * FROM public.subscriptions WHERE asaas_env = 'production') s ON s.id = n.subscription_id
   WHERE public.has_role(auth.uid(), 'super_admin'::app_role)
     AND (_status IS NULL OR n.status = _status)
     AND (_canal IS NULL OR n.channel = _canal)
     AND (
       _busca IS NULL OR btrim(_busca) = ''
       OR c.name ILIKE '%' || _busca || '%'
       OR n.recipient ILIKE '%' || _busca || '%'
     )
   ORDER BY n.created_at DESC
   LIMIT LEAST(GREATEST(coalesce(_limite, 300), 1), 500);
$$;

-- 7) Funil do pós-teste (super admin)
CREATE OR REPLACE FUNCTION public.billing_regua_funil_pos_teste(_dias integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dias int := LEAST(GREATEST(coalesce(_dias, 60), 1), 365); r jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  WITH base AS (
    SELECT s.company_id, min(s.trial_ends_at) AS fim
      FROM public.subscriptions s
     WHERE s.asaas_env = 'production' AND s.company_id IS NOT NULL AND s.trial_ends_at IS NOT NULL
       AND s.trial_ends_at < now() AND s.trial_ends_at >= now() - make_interval(days => v_dias)
     GROUP BY s.company_id
  ), pago AS (
    SELECT b.company_id, min(i.paid_at) AS pago_em
      FROM base b
      JOIN public.subscriptions s ON s.company_id = b.company_id AND s.asaas_env = 'production'
      JOIN public.invoices i ON i.subscription_id = s.id AND i.asaas_env = 'production'
     WHERE i.status::text = 'paid' AND i.paid_at IS NOT NULL AND i.paid_at >= b.fim
     GROUP BY b.company_id
  ), env AS (
    SELECT n.company_id, n.stage, min(n.sent_at) AS em
      FROM public.billing_notifications n
      JOIN base b ON b.company_id = n.company_id
     WHERE n.status = 'sent' AND n.stage IN ('trial_pos_1', 'trial_pos_4', 'trial_pos_8')
     GROUP BY n.company_id, n.stage
  ), atrib AS (
    SELECT p.company_id,
      (SELECT e.stage FROM env e WHERE e.company_id = p.company_id AND e.em <= p.pago_em
        ORDER BY e.em DESC LIMIT 1) AS ultima
      FROM pago p
  )
  SELECT jsonb_build_object(
    'dias', v_dias,
    'encerrados', (SELECT count(*) FROM base),
    'tentativa_1', (SELECT count(DISTINCT company_id) FROM env WHERE stage = 'trial_pos_1'),
    'tentativa_2', (SELECT count(DISTINCT company_id) FROM env WHERE stage = 'trial_pos_4'),
    'tentativa_3', (SELECT count(DISTINCT company_id) FROM env WHERE stage = 'trial_pos_8'),
    'contrataram', (SELECT count(*) FROM atrib),
    'contratou_sem_tentativa', (SELECT count(*) FROM atrib WHERE ultima IS NULL),
    'contratou_apos_1', (SELECT count(*) FROM atrib WHERE ultima = 'trial_pos_1'),
    'contratou_apos_2', (SELECT count(*) FROM atrib WHERE ultima = 'trial_pos_4'),
    'contratou_apos_3', (SELECT count(*) FROM atrib WHERE ultima = 'trial_pos_8')
  ) INTO r;
  RETURN r;
END $$;

-- 8) Permissões: só o que o navegador chama
REVOKE ALL ON FUNCTION public.billing_regua_config_obter() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_regua_whatsapp_definir(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_v2_whatsapp_cobranca_obter(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_v2_whatsapp_cobranca_definir(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_regua_historico(text, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_regua_funil_pos_teste(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_dunning_scan() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_regua_config_obter() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_regua_whatsapp_definir(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_v2_whatsapp_cobranca_obter(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_v2_whatsapp_cobranca_definir(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_regua_historico(text, text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_regua_funil_pos_teste(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_dunning_scan() TO service_role;