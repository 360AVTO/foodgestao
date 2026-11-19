CREATE OR REPLACE FUNCTION public.concierge_ativar(
  p_grupo_id uuid, p_user_id uuid,
  p_papel text DEFAULT NULL,
  p_proprietario_nome text DEFAULT NULL,
  p_proprietario_whatsapp text DEFAULT NULL,
  p_convidar_proprietario boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_p record; v_dias int := 7; v_raw text; v_fim timestamptz; v_mod text; v_quer text[]; v_sub uuid; v_plan uuid; v_acc uuid;
  v_papel text := nullif(btrim(coalesce(p_papel, '')), '');
  v_pnome text := nullif(upper(regexp_replace(btrim(coalesce(p_proprietario_nome, '')), '\s+', ' ', 'g')), '');
  v_pwa text := regexp_replace(coalesce(p_proprietario_whatsapp, ''), '\D', '', 'g');
  v_gwa text;
  v_convidar boolean;
  v_owner_grupo uuid; v_owner_token text; v_inv record; v_emp text; v_empresas text[] := ARRAY[]::text[];
  v_ativadas int := 0; v_assumidas int := 0;
BEGIN
  IF v_papel IS NOT NULL AND v_papel NOT IN ('owner', 'admin') THEN RAISE EXCEPTION 'papel_invalido'; END IF;
  IF length(v_pwa) IN (12, 13) AND left(v_pwa, 2) = '55' THEN v_pwa := substr(v_pwa, 3); END IF;
  v_convidar := v_papel = 'admin' AND coalesce(p_convidar_proprietario, false);

  -- a) Proprietário indicado na ativação aceitou o convite de Dono: assume a titularidade.
  FOR v_p IN SELECT * FROM concierge_provisionamentos
              WHERE proprietario_invite_grupo_id = p_grupo_id AND proprietario_assumiu_em IS NULL FOR UPDATE LOOP
    UPDATE companies SET user_id = p_user_id
     WHERE id = v_p.company_id AND user_id = v_p.ativado_user_id AND p_user_id IS DISTINCT FROM v_p.ativado_user_id;
    UPDATE company_members SET role = 'owner', perfil = 'dono' WHERE company_id = v_p.company_id AND user_id = p_user_id;
    UPDATE concierge_provisionamentos SET proprietario_assumiu_em = now(), proprietario_user_id = p_user_id
     WHERE company_id = v_p.company_id;
    v_assumidas := v_assumidas + 1;
  END LOOP;

  -- b) Primeiro acesso do gestor de empresa preparada pela Aveto.
  IF NOT EXISTS (SELECT 1 FROM concierge_provisionamentos WHERE invite_grupo_id = p_grupo_id AND ativado_em IS NULL) THEN
    RETURN jsonb_build_object('ativadas', 0, 'titular_assumido', v_assumidas, 'proprietario_convite', NULL);
  END IF;

  IF v_papel = 'admin' THEN
    IF v_pnome IS NULL OR length(regexp_replace(v_pnome, '[^[:alpha:]]', '', 'g')) < 3 THEN
      RAISE EXCEPTION 'proprietario_nome_obrigatorio';
    END IF;
    IF length(v_pwa) NOT IN (10, 11) THEN RAISE EXCEPTION 'proprietario_whatsapp_invalido'; END IF;
    SELECT regexp_replace(coalesce(phone, ''), '\D', '', 'g') INTO v_gwa FROM profiles WHERE user_id = p_user_id;
    IF length(v_gwa) IN (12, 13) AND left(v_gwa, 2) = '55' THEN v_gwa := substr(v_gwa, 3); END IF;
    IF v_gwa = v_pwa
       OR EXISTS (SELECT 1 FROM concierge_provisionamentos WHERE invite_grupo_id = p_grupo_id
                    AND regexp_replace(coalesce(gestor_whatsapp, ''), '\D', '', 'g') = v_pwa)
       OR EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id AND lower(email) = 'wa' || v_pwa || '@usuarios.aveto360.local') THEN
      RAISE EXCEPTION 'proprietario_igual_gestor';
    END IF;
  END IF;

  SELECT regexp_replace(value::text, '\D', '', 'g') INTO v_raw FROM system_parameters WHERE key = 'trial_cadastro_dias';
  IF v_raw ~ '^\d+$' AND v_raw::int BETWEEN 1 AND 90 THEN v_dias := v_raw::int; END IF;
  v_fim := now() + make_interval(days => v_dias);

  FOR v_p IN SELECT * FROM concierge_provisionamentos WHERE invite_grupo_id = p_grupo_id AND ativado_em IS NULL FOR UPDATE LOOP
    UPDATE companies SET
        user_id = p_user_id, trial_iniciado_em = now(), trial_termina_em = v_fim,
        proprietario_nome = CASE
          WHEN v_papel = 'admin' THEN v_pnome
          WHEN v_papel = 'owner' THEN coalesce(nullif(btrim(proprietario_nome), ''), upper(btrim(v_p.gestor_nome)))
          ELSE proprietario_nome END,
        proprietario_whatsapp = CASE
          WHEN v_papel = 'admin' THEN '55' || v_pwa
          WHEN v_papel = 'owner' THEN coalesce(nullif(btrim(proprietario_whatsapp), ''),
            CASE WHEN length(regexp_replace(coalesce(v_p.gestor_whatsapp, ''), '\D', '', 'g')) IN (10, 11)
                 THEN '55' || regexp_replace(v_p.gestor_whatsapp, '\D', '', 'g') END)
          ELSE proprietario_whatsapp END
     WHERE id = v_p.company_id
     RETURNING coalesce(nullif(btrim(trade_name), ''), name) INTO v_emp;
    UPDATE company_modules SET starts_at = now(), ends_at = v_fim, trial_iniciado_em = now(), trial_termina_em = v_fim
     WHERE company_id = v_p.company_id AND status = 'trial';
    DELETE FROM company_members WHERE company_id = v_p.company_id AND user_id = v_p.criado_por AND user_id <> p_user_id;
    UPDATE company_members
       SET role = CASE WHEN v_papel = 'admin' THEN 'admin'::company_role ELSE 'owner'::company_role END,
           perfil = CASE WHEN v_papel = 'admin' THEN 'administrador' ELSE 'dono' END
     WHERE company_id = v_p.company_id AND user_id = p_user_id;
    UPDATE profiles SET onboarding_completed = true, profile_type = 'empresarial' WHERE user_id = p_user_id;

    v_quer := ARRAY[]::text[];
    IF 'dp' = ANY(v_p.modulos) THEN v_quer := array_append(v_quer, 'pessoas'); END IF;
    IF 'financeiro' = ANY(v_p.modulos) THEN v_quer := array_append(v_quer, 'financeiro'); END IF;
    FOREACH v_mod IN ARRAY v_quer LOOP
      v_sub := NULL;
      SELECT id INTO v_sub FROM subscriptions WHERE user_id = p_user_id AND module = v_mod AND status IN ('trialing','active')
        ORDER BY created_at DESC LIMIT 1;
      IF v_sub IS NULL THEN
        SELECT id INTO v_plan FROM plans WHERE slug = v_mod || '-gestao' AND is_active LIMIT 1;
        IF v_plan IS NOT NULL THEN
          BEGIN
            v_acc := billing_v2_user_empty_account(p_user_id, true);
            INSERT INTO subscriptions (user_id, plan_id, module, status, trial_ends_at, current_period_end, billing_account_id)
            VALUES (p_user_id, v_plan, v_mod, 'trialing', v_fim, v_fim, v_acc) RETURNING id INTO v_sub;
            INSERT INTO trial_usage (titular_user_id, email, module, plan_id, subscription_id, origem, started_at, ends_at)
            SELECT p_user_id, lower(u.email), v_mod, v_plan, v_sub, 'concierge', now(), v_fim FROM auth.users u WHERE u.id = p_user_id;
          EXCEPTION WHEN unique_violation THEN NULL;
          END;
        END IF;
      END IF;
      IF v_sub IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subscription_companies WHERE company_id = v_p.company_id AND module = v_mod AND removed_at IS NULL) THEN
        INSERT INTO subscription_companies (subscription_id, company_id, module) VALUES (v_sub, v_p.company_id, v_mod);
      END IF;
    END LOOP;

    IF v_convidar THEN
      INSERT INTO company_invites (company_id, invited_email, role, invited_by, full_name, whatsapp, perfil, modulos, expires_at, grupo_id)
      SELECT v_p.company_id, NULL, 'owner', p_user_id, v_pnome, v_pwa, 'dono',
             coalesce((SELECT ci.modulos FROM company_invites ci WHERE ci.id = v_p.invite_id),
                      jsonb_build_object('conta', true, 'pessoas', 'dp' = ANY(v_p.modulos), 'financeiro', 'financeiro' = ANY(v_p.modulos))),
             now() + interval '15 days', coalesce(v_owner_grupo, gen_random_uuid())
      RETURNING grupo_id, token INTO v_inv;
      v_owner_grupo := v_inv.grupo_id;
      v_owner_token := coalesce(v_owner_token, v_inv.token);
    END IF;

    UPDATE concierge_provisionamentos
       SET ativado_em = now(), ativado_user_id = p_user_id, ativado_papel = coalesce(v_papel, 'owner'),
           proprietario_invite_grupo_id = CASE WHEN v_convidar THEN v_owner_grupo END
     WHERE company_id = v_p.company_id;
    v_ativadas := v_ativadas + 1;
    v_empresas := array_append(v_empresas, v_emp);
  END LOOP;

  RETURN jsonb_build_object(
    'ativadas', v_ativadas,
    'titular_assumido', v_assumidas,
    'papel', coalesce(v_papel, 'owner'),
    'proprietario_convite', CASE WHEN v_owner_token IS NOT NULL THEN jsonb_build_object(
      'token', v_owner_token, 'nome', v_pnome, 'whatsapp', v_pwa, 'empresas', to_jsonb(v_empresas)) END
  );
END $function$;

REVOKE ALL ON FUNCTION public.concierge_ativar(uuid, uuid, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.concierge_ativar(uuid, uuid, text, text, text, boolean) TO service_role;