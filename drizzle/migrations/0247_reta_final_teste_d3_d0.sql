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
  v_dow integer := extract(isodow FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::integer;
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
      IF s.status::text = 'trialing' AND v_dow <= 5 AND (
           v_d = 0 OR (v_dow = 5 AND v_d IN (-1, -2))
         ) THEN
        -- último dia; se cair no fim de semana, sai na sexta anterior
        v_stage := 'trial_d7';
      ELSIF s.status::text = 'trialing' AND v_dow <= 5 AND (
           v_d = -3 OR (v_dow = 5 AND v_d = -4) OR (v_dow = 1 AND v_d = -2)
         ) THEN
        -- aviso de 3 dias; sábado antecipa para sexta, domingo passa para segunda
        v_stage := 'trial_d5';
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

-- Backoffice: testes na reta final, para a equipe Aveto priorizar o contato
CREATE OR REPLACE FUNCTION public.billing_regua_reta_final(_dias integer DEFAULT 5)
 RETURNS TABLE(
   company_id uuid, subscription_id uuid, empresa text, modulo text, trial_ends_at timestamptz,
   dias_restantes integer, colaboradores integer, unidades integer,
   contato_nome text, contato_telefone text,
   aviso_enviado_em timestamptz, ultimo_dia_enviado_em timestamptz
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_dias integer := LEAST(GREATEST(coalesce(_dias, 5), 0), 15);
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH base AS (
    SELECT s.id AS sub_id, c.id AS emp_id, c.name AS emp_nome, c.user_id AS dono, s.module::text AS mod,
           s.trial_ends_at AS fim,
           ((s.trial_ends_at AT TIME ZONE 'America/Sao_Paulo')::date - v_hoje)::integer AS restam
      FROM public.subscriptions s
      JOIN public.companies c ON c.id = s.company_id
     WHERE s.asaas_env = 'production' AND s.status::text = 'trialing' AND s.trial_ends_at IS NOT NULL
       AND (s.trial_ends_at AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN v_hoje AND v_hoje + v_dias
  )
  SELECT b.emp_id, b.sub_id, b.emp_nome::text, b.mod, b.fim, b.restam,
    coalesce(public._billing_v2_colaboradores_ativos(
      (SELECT bac.billing_account_id FROM public.billing_account_companies bac
        WHERE bac.company_id = b.emp_id AND bac.removed_at IS NULL LIMIT 1),
      b.emp_id), 0)::integer AS colab,
    (SELECT count(*) FROM public.dp_unidades u WHERE u.company_id = b.emp_id AND u.ativo IS TRUE)::integer,
    p.full_name::text, p.phone::text,
    (SELECT min(n.sent_at) FROM public.billing_notifications n
      WHERE n.subscription_id = b.sub_id AND n.stage = 'trial_d5' AND n.status = 'sent'),
    (SELECT min(n.sent_at) FROM public.billing_notifications n
      WHERE n.subscription_id = b.sub_id AND n.stage = 'trial_d7' AND n.status = 'sent')
  FROM base b
  LEFT JOIN public.profiles p ON p.user_id = b.dono
  ORDER BY colab DESC, b.fim ASC;
END $function$;

REVOKE ALL ON FUNCTION public.billing_regua_reta_final(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_regua_reta_final(integer) TO authenticated, service_role;