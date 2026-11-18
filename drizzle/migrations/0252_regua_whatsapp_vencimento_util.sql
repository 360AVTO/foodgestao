CREATE OR REPLACE FUNCTION public.billing_feriado_bancario(_d date)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT to_char(_d, 'MM-DD') IN ('01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25')
      OR _d IN (
        public.dp_pascoa(extract(year FROM _d)::int) - 48,
        public.dp_pascoa(extract(year FROM _d)::int) - 47,
        public.dp_pascoa(extract(year FROM _d)::int) - 2,
        public.dp_pascoa(extract(year FROM _d)::int) + 60
      );
$$;

CREATE OR REPLACE FUNCTION public.billing_vencimento_util(_d date)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE v date := _d;
BEGIN
  IF v IS NULL THEN RETURN NULL; END IF;
  WHILE extract(isodow FROM v) IN (6, 7) OR public.billing_feriado_bancario(v) LOOP
    v := v + 1;
  END LOOP;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.billing_feriado_bancario(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_vencimento_util(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_feriado_bancario(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_vencimento_util(date) TO service_role;

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
  v_du integer;
  v_cartao boolean;
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
        v_stage := 'trial_d7';
      ELSIF s.status::text = 'trialing' AND v_dow <= 5 AND (
           v_d = -3 OR (v_dow = 5 AND v_d = -4) OR (v_dow = 1 AND v_d = -2)
         ) THEN
        v_stage := 'trial_d5';
      ELSIF v_d IN (1, 4, 8) THEN
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

    SELECT i.id, i.amount_cents, i.due_date, i.external_payment_url, i.payment_method INTO v_fat
      FROM (SELECT * FROM public.invoices WHERE asaas_env = 'production') i
     WHERE i.subscription_id = s.id AND i.status IN ('open', 'overdue')
     ORDER BY i.due_date ASC LIMIT 1;
    IF v_fat.id IS NULL THEN CONTINUE; END IF;

    v_d := (v_hoje - v_fat.due_date)::integer;
    -- vencimento útil bancário: sábado/domingo/feriado nacional prorroga para o 1º dia útil
    v_du := (v_hoje - public.billing_vencimento_util(v_fat.due_date))::integer;
    v_cartao := COALESCE(v_fat.payment_method::text, '') = 'card';
    v_stage := CASE
      WHEN v_d = -3 AND NOT v_cartao THEN 'd_menos_3'
      WHEN v_du = 0 AND NOT v_cartao THEN 'd_0'
      WHEN v_du = 1 THEN 'd_mais_1'
      WHEN v_d = 8 THEN 'd_mais_8' WHEN v_d = 10 THEN 'd_mais_10' WHEN v_d = 11 THEN 'd_mais_11'
      WHEN v_d = 20 THEN 'd_mais_20' WHEN v_d = 28 THEN 'd_mais_28' WHEN v_d = 31 THEN 'd_mais_31'
      WHEN v_d = 60 THEN 'd_mais_60' WHEN v_d = 80 THEN 'd_mais_80' WHEN v_d = 90 THEN 'd_mais_90'
      WHEN v_du = 5 THEN 'd_mais_5'
      ELSE NULL END;
    IF v_stage IS NULL THEN CONTINUE; END IF;

    RETURN QUERY SELECT v_company.id, s.id, v_fat.id, v_stage,
      CASE WHEN v_stage IN ('d_0', 'd_mais_1', 'd_mais_5') THEN v_du ELSE v_d END,
      v_fat.amount_cents, v_fat.due_date,
      (v_fat.due_date + 90)::date, v_company.user_id, v_company.name, v_company.cnpj, v_company.email,
      v_fat.external_payment_url, s.module;
  END LOOP;
END;
$function$;

-- Candidatos aos toques de relacionamento do WhatsApp (o marco do dia é decidido
-- em _shared/billing-vencimento-util.ts). Só produção, sem isentos nem pausados.
CREATE OR REPLACE FUNCTION public.billing_whatsapp_candidatos()
RETURNS TABLE(tipo text, company_id uuid, subscription_id uuid, invoice_id uuid, amount_cents integer,
  due_date date, invoice_created_on date, payment_method text, payment_url text, fim date, encerramento text,
  owner_user_id uuid, company_name text, company_trade_name text, company_cnpj text, company_email text, modulo text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s record;
  v_company record;
  v_fat record;
  v_fim date;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  FOR s IN
    SELECT sub.* FROM public.subscriptions sub
     WHERE sub.asaas_env = 'production'
       AND (sub.is_exempt IS NOT TRUE OR (sub.exempt_until IS NOT NULL AND sub.exempt_until < now()))
       AND (sub.dunning_paused_until IS NULL OR sub.dunning_paused_until < now())
       AND sub.status::text IN ('active', 'past_due', 'trialing', 'expired')
     ORDER BY CASE WHEN sub.module IN ('pessoas', 'dp') THEN 0 ELSE 1 END, sub.created_at
  LOOP
    SELECT c.id, c.name, c.trade_name, c.cnpj, c.email, c.user_id INTO v_company
      FROM public.companies c
     WHERE (s.company_id IS NOT NULL AND c.id = s.company_id)
        OR (s.company_id IS NULL AND c.user_id = s.user_id AND c.is_active IS TRUE)
     ORDER BY c.created_at ASC LIMIT 1;
    IF v_company.id IS NULL THEN CONTINUE; END IF;

    IF s.status::text IN ('active', 'past_due') THEN
      v_fat := NULL;
      SELECT i.id, i.amount_cents, i.due_date, i.created_at, i.payment_method, i.external_payment_url INTO v_fat
        FROM public.invoices i
       WHERE i.asaas_env = 'production' AND i.subscription_id = s.id AND i.status IN ('open', 'overdue')
         AND i.due_date BETWEEN v_hoje - 12 AND v_hoje + 10
       ORDER BY i.due_date ASC LIMIT 1;
      IF v_fat.id IS NULL THEN CONTINUE; END IF;
      RETURN QUERY SELECT 'fatura'::text, v_company.id, s.id, v_fat.id, v_fat.amount_cents, v_fat.due_date,
        (v_fat.created_at AT TIME ZONE 'America/Sao_Paulo')::date, v_fat.payment_method::text,
        v_fat.external_payment_url, NULL::date, NULL::text, v_company.user_id, v_company.name,
        v_company.trade_name, v_company.cnpj, v_company.email, s.module;
      CONTINUE;
    END IF;

    -- teste ou carência encerrados recentemente, sem nada contratado na empresa
    v_fim := (GREATEST(s.trial_ends_at, s.grace_ends_at) AT TIME ZONE 'America/Sao_Paulo')::date;
    IF v_fim IS NULL OR v_fim > v_hoje - 2 OR v_fim < v_hoje - 9 THEN CONTINUE; END IF;
    IF EXISTS (
      SELECT 1 FROM public.subscriptions o
       WHERE o.asaas_env = 'production' AND o.id <> s.id
         AND o.status::text IN ('active', 'grace', 'past_due')
         AND (o.company_id = v_company.id OR (o.company_id IS NULL AND o.user_id = v_company.user_id))
    ) THEN CONTINUE; END IF;
    RETURN QUERY SELECT 'pos_fim'::text, v_company.id, s.id, NULL::uuid, NULL::integer, NULL::date, NULL::date,
      NULL::text, NULL::text, v_fim,
      CASE WHEN s.grace_ends_at IS NOT NULL AND (s.trial_ends_at IS NULL OR s.grace_ends_at >= s.trial_ends_at)
        THEN 'carencia' ELSE 'teste' END,
      v_company.user_id, v_company.name, v_company.trade_name, v_company.cnpj, v_company.email, s.module;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_whatsapp_candidatos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_whatsapp_candidatos() TO service_role;