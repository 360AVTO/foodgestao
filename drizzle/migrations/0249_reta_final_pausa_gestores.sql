DROP FUNCTION IF EXISTS public.billing_regua_reta_final(integer);

CREATE FUNCTION public.billing_regua_reta_final(_dias integer DEFAULT 5)
 RETURNS TABLE(company_id uuid, subscription_id uuid, empresa text, modulo text, trial_ends_at timestamp with time zone, dias_restantes integer, colaboradores integer, unidades integer, contato_nome text, contato_telefone text, aviso_enviado_em timestamp with time zone, ultimo_dia_enviado_em timestamp with time zone, pausada_ate timestamp with time zone, pausa_motivo text, gestores jsonb)
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
           ((s.trial_ends_at AT TIME ZONE 'America/Sao_Paulo')::date - v_hoje)::integer AS restam,
           s.dunning_paused_until AS pausa, s.dunning_pause_reason AS pausa_txt
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
      WHERE n.subscription_id = b.sub_id AND n.stage = 'trial_d7' AND n.status = 'sent'),
    CASE WHEN b.pausa > now() THEN b.pausa END,
    CASE WHEN b.pausa > now() THEN b.pausa_txt::text END,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('nome', g.nome, 'telefone', g.tel, 'papel', g.papel)
                               ORDER BY g.ordem, g.nome), '[]'::jsonb)
       FROM (
         SELECT DISTINCT ON (x.uid) x.uid, x.papel, x.ordem, pr.full_name::text AS nome, pr.phone::text AS tel
           FROM (
             SELECT b.dono AS uid, 'dono'::text AS papel, 0 AS ordem
             UNION ALL
             SELECT cm.user_id, CASE WHEN cm.role::text = 'owner' THEN 'dono' ELSE 'admin' END,
                    CASE WHEN cm.role::text = 'owner' THEN 0 ELSE 1 END
               FROM public.company_members cm
              WHERE cm.company_id = b.emp_id AND cm.situacao = 'ativo' AND cm.role::text IN ('owner', 'admin')
           ) x
           LEFT JOIN public.profiles pr ON pr.user_id = x.uid
          WHERE x.uid IS NOT NULL
          ORDER BY x.uid, x.ordem
       ) g)
  FROM base b
  LEFT JOIN public.profiles p ON p.user_id = b.dono
  ORDER BY colab DESC, b.fim ASC;
END $function$;

REVOKE ALL ON FUNCTION public.billing_regua_reta_final(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_regua_reta_final(integer) TO authenticated, service_role;