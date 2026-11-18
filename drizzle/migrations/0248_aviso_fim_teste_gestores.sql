CREATE OR REPLACE FUNCTION public._module_access_core(_company_id uuid, _module text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_mod text := CASE WHEN _module IN ('dp','pessoas','portal') THEN 'pessoas' ELSE _module END;
  s record; f record; v_atraso int; v_motivo text; v_best jsonb := NULL; v_cur jsonb; v_grant record; v_found boolean := false;
  v_exp record;
BEGIN
  FOR s IN
    SELECT sub.* FROM (SELECT * FROM public.subscriptions WHERE asaas_env = 'production') sub
    JOIN subscription_companies sc ON sc.subscription_id = sub.id AND sc.company_id = _company_id
      AND sc.removed_at IS NULL AND COALESCE(sc.module, sub.module) = v_mod
    WHERE COALESCE(sub.module,'financeiro') = v_mod AND sub.status::text NOT IN ('canceled','expired')
    ORDER BY sub.created_at DESC
  LOOP
    v_found := true; v_atraso := NULL; v_motivo := NULL; f := NULL;
    SELECT i.id, i.due_date INTO f FROM (SELECT * FROM public.invoices WHERE asaas_env = 'production') i
     WHERE i.subscription_id = s.id AND i.status IN ('open','overdue') AND i.due_date < current_date
     ORDER BY i.due_date LIMIT 1;
    IF f.id IS NOT NULL THEN v_atraso := (current_date - f.due_date)::int; END IF;

    SELECT g.* INTO v_grant FROM subscription_grants g
     WHERE g.subscription_id = s.id AND g.revoked_at IS NULL
       AND g.tipo IN ('cortesia_total','carencia')
       AND (g.starts_at IS NULL OR g.starts_at <= now())
       AND ((g.tipo = 'cortesia_total' AND (g.ends_at IS NULL OR g.ends_at > now()))
         OR (g.tipo = 'carencia' AND g.ends_at > now()))
     ORDER BY (g.tipo = 'cortesia_total') DESC LIMIT 1;

    IF v_grant.id IS NOT NULL THEN v_motivo := NULL;
    ELSIF s.status::text = 'trialing' THEN
      IF s.trial_ends_at IS NULL OR s.trial_ends_at < now() THEN v_motivo := 'trial_expirado'; END IF;
    ELSIF s.status::text = 'grace' THEN
      IF s.grace_ends_at IS NULL OR s.grace_ends_at < now() THEN v_motivo := 'carencia_expirada'; END IF;
    ELSIF s.status::text IN ('active','past_due','pending') THEN
      IF v_atraso IS NULL OR v_atraso <= 10 THEN v_motivo := NULL;
      ELSIF v_atraso <= 30 THEN v_motivo := 'inadimplente_suspenso';
      ELSIF v_atraso <= 90 THEN v_motivo := 'rescindido';
      ELSE v_motivo := 'expirado_definitivo'; END IF;
    ELSE v_motivo := 'sem_assinatura';
    END IF;

    v_cur := jsonb_build_object('module', v_mod, 'allowed', v_motivo IS NULL, 'status', s.status::text,
      'motivo', v_motivo, 'subscription_id', s.id,
      'grant', CASE WHEN v_grant.id IS NOT NULL THEN v_grant.tipo::text END,
      'dias_restantes', CASE
          WHEN v_grant.id IS NOT NULL AND v_grant.ends_at IS NOT NULL THEN GREATEST(0, ceil(EXTRACT(EPOCH FROM v_grant.ends_at - now())/86400))::int
          WHEN s.status::text = 'trialing' AND s.trial_ends_at IS NOT NULL THEN GREATEST(0, ceil(EXTRACT(EPOCH FROM s.trial_ends_at - now())/86400))::int
          WHEN s.status::text = 'grace' AND s.grace_ends_at IS NOT NULL THEN GREATEST(0, ceil(EXTRACT(EPOCH FROM s.grace_ends_at - now())/86400))::int END,
      'trial_ends_at', s.trial_ends_at,
      'grace_ends_at', CASE WHEN v_grant.tipo = 'carencia' THEN v_grant.ends_at WHEN s.status::text='grace' THEN s.grace_ends_at END,
      'dias_atraso', v_atraso, 'fatura_pendente_id', f.id,
      'can_export', COALESCE(v_motivo,'') <> 'expirado_definitivo');
    IF v_motivo IS NULL THEN RETURN v_cur; END IF;
    IF v_best IS NULL THEN v_best := v_cur; END IF;
  END LOOP;
  IF NOT v_found THEN
    -- Sem plano vigente: se o último vínculo do módulo foi um teste ou uma carência
    -- que terminou, informa esse motivo real (com a data) em vez de "sem cobertura".
    SELECT sub.id, sub.trial_ends_at, sub.grace_ends_at INTO v_exp
      FROM public.subscriptions sub
      JOIN subscription_companies sc ON sc.subscription_id = sub.id AND sc.company_id = _company_id
        AND sc.removed_at IS NULL AND COALESCE(sc.module, sub.module) = v_mod
     WHERE sub.asaas_env = 'production' AND COALESCE(sub.module,'financeiro') = v_mod
       AND sub.status::text = 'expired'
       AND (sub.grace_ends_at IS NOT NULL OR sub.trial_ends_at IS NOT NULL)
     ORDER BY COALESCE(sub.grace_ends_at, sub.trial_ends_at) DESC
     LIMIT 1;
    IF v_exp.id IS NOT NULL THEN
      RETURN jsonb_build_object('module', v_mod, 'allowed', false, 'status', 'expired',
        'motivo', CASE WHEN v_exp.grace_ends_at IS NOT NULL THEN 'carencia_expirada' ELSE 'trial_expirado' END,
        'subscription_id', v_exp.id, 'grant', NULL, 'dias_restantes', 0,
        'trial_ends_at', v_exp.trial_ends_at, 'grace_ends_at', v_exp.grace_ends_at,
        'dias_atraso', NULL, 'fatura_pendente_id', NULL, 'can_export', true);
    END IF;
    RETURN jsonb_build_object('module', v_mod, 'allowed', false, 'status', NULL, 'motivo', 'sem_cobertura',
      'dias_restantes', NULL, 'trial_ends_at', NULL, 'grace_ends_at', NULL, 'dias_atraso', NULL,
      'fatura_pendente_id', NULL, 'can_export', true);
  END IF;
  RETURN v_best;
END $function$;

-- Resumo para o balão de fim de teste/carência dos gestores: só para quem é da empresa.
CREATE OR REPLACE FUNCTION public.billing_aviso_assinatura(_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_comp record; v_role text; v_conta uuid;
  v_colab int; v_unid int; v_resp jsonb; v_nome text;
BEGIN
  IF v_uid IS NULL OR _company_id IS NULL THEN RETURN NULL; END IF;
  IF NOT public._is_company_member(_company_id, v_uid) THEN RETURN NULL; END IF;

  SELECT c.id, c.name, c.user_id INTO v_comp FROM public.companies c WHERE c.id = _company_id;
  SELECT m.role::text INTO v_role FROM public.company_members m
   WHERE m.company_id = _company_id AND m.user_id = v_uid LIMIT 1;
  SELECT b.billing_account_id INTO v_conta FROM public.billing_account_companies b
   WHERE b.company_id = _company_id AND b.removed_at IS NULL LIMIT 1;

  v_colab := COALESCE(public._billing_v2_colaboradores_ativos(v_conta, _company_id), 0);
  SELECT count(*)::int INTO v_unid FROM public.dp_unidades u WHERE u.company_id = _company_id AND u.ativo IS TRUE;
  SELECT NULLIF(trim(p.full_name), '') INTO v_nome FROM public.profiles p WHERE p.user_id = v_uid LIMIT 1;

  SELECT COALESCE(jsonb_agg(r.nome ORDER BY r.ordem, r.nome), '[]'::jsonb) INTO v_resp
  FROM (
    SELECT DISTINCT ON (x.uid) x.uid, x.ordem, NULLIF(trim(p.full_name), '') AS nome
    FROM (
      SELECT v_comp.user_id AS uid, 0 AS ordem
      UNION ALL
      SELECT m.user_id, CASE WHEN m.role::text = 'owner' THEN 0 ELSE 1 END
        FROM public.company_members m
       WHERE m.company_id = _company_id AND m.role::text IN ('owner','admin')
         AND COALESCE(m.situacao, 'ativo') = 'ativo'
    ) x
    LEFT JOIN public.profiles p ON p.user_id = x.uid
    WHERE x.uid IS NOT NULL
    ORDER BY x.uid, x.ordem
  ) r
  WHERE r.nome IS NOT NULL;

  RETURN jsonb_build_object(
    'empresa', v_comp.name,
    'colaboradores', v_colab,
    'unidades', COALESCE(v_unid, 0),
    'meu_nome', v_nome,
    'pode_contratar', (v_comp.user_id = v_uid OR COALESCE(v_role, '') IN ('owner','admin')
                       OR COALESCE(public.is_super_admin(v_uid), false)),
    'responsaveis', v_resp
  );
END $function$;

REVOKE ALL ON FUNCTION public.billing_aviso_assinatura(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_aviso_assinatura(uuid) TO authenticated, service_role;