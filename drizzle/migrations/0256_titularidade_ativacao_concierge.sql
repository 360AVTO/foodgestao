ALTER TABLE public.concierge_provisionamentos
  ADD COLUMN IF NOT EXISTS ativado_papel text,
  ADD COLUMN IF NOT EXISTS proprietario_invite_grupo_id uuid,
  ADD COLUMN IF NOT EXISTS proprietario_assumiu_em timestamptz,
  ADD COLUMN IF NOT EXISTS proprietario_user_id uuid;

ALTER TABLE public.concierge_provisionamentos
  DROP CONSTRAINT IF EXISTS concierge_ativado_papel_chk;
ALTER TABLE public.concierge_provisionamentos
  ADD CONSTRAINT concierge_ativado_papel_chk CHECK (ativado_papel IS NULL OR ativado_papel IN ('owner','admin'));

COMMENT ON COLUMN public.concierge_provisionamentos.ativado_papel IS 'Papel informado pelo gestor no primeiro acesso: owner (proprietário) ou admin (administrador).';
COMMENT ON COLUMN public.concierge_provisionamentos.proprietario_invite_grupo_id IS 'Grupo do convite de Dono enviado ao proprietário indicado pelo administrador na ativação.';

-- 1) Primeira loja: só o telefone da empresa, nunca o WhatsApp pessoal do gestor
CREATE OR REPLACE FUNCTION public.dp_criar_unidade_inicial(p_company_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_c public.companies%ROWTYPE;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nao_autenticado'; END IF;
  SELECT * INTO v_c FROM public.companies WHERE id = p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'empresa_nao_encontrada'; END IF;
  IF v_c.user_id <> auth.uid() AND NOT public.tem_permissao(p_company_id, 'dp.unidades', 'inclusao') THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;
  SELECT id INTO v_id FROM public.dp_unidades WHERE company_id = p_company_id ORDER BY created_at LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.dp_unidades (company_id, nome, cnpj, cep, logradouro, numero, complemento, bairro, cidade, uf, telefone, timezone, endereco)
  VALUES (p_company_id, COALESCE(NULLIF(v_c.trade_name,''), v_c.name), v_c.cnpj, v_c.cep, v_c.logradouro, v_c.numero,
          v_c.complemento, v_c.bairro, v_c.cidade, v_c.uf, NULLIF(btrim(coalesce(v_c.phone, '')), ''), v_c.timezone,
          NULLIF(concat_ws(', ', v_c.logradouro, v_c.numero, v_c.bairro), ''))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- 2) Preparar empresa: gestor convidado como Administrador; WhatsApp dele não vira contato da empresa
CREATE OR REPLACE FUNCTION public.admin_provisionar_empresa_concierge(p_cnpj text, p_razao_social text, p_nome_fantasia text, p_cep text, p_logradouro text, p_numero text, p_complemento text, p_bairro text, p_cidade text, p_uf text, p_telefone_empresa text, p_email_empresa text, p_gestor_nome text, p_gestor_email text, p_gestor_whatsapp text, p_modulos text[], p_criar_unidade boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_cnpj text := regexp_replace(coalesce(p_cnpj,''), '\D', '', 'g');
  v_wa text := regexp_replace(coalesce(p_gestor_whatsapp,''), '\D', '', 'g');
  v_email text := lower(nullif(trim(coalesce(p_gestor_email,'')), ''));
  v_company uuid; v_slug text; v_inv record; v_existe boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN RAISE EXCEPTION 'sem_permissao'; END IF;
  IF length(v_cnpj) <> 14 THEN RAISE EXCEPTION 'cnpj_invalido'; END IF;
  IF coalesce(trim(p_razao_social),'') = '' THEN RAISE EXCEPTION 'razao_social_obrigatoria'; END IF;
  IF coalesce(trim(p_gestor_nome),'') = '' THEN RAISE EXCEPTION 'gestor_nome_obrigatorio'; END IF;
  IF v_email IS NULL AND length(v_wa) < 10 THEN RAISE EXCEPTION 'gestor_contato_obrigatorio'; END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'email_invalido'; END IF;
  IF p_modulos IS NULL OR array_length(p_modulos,1) IS NULL THEN RAISE EXCEPTION 'nenhum_modulo_selecionado'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_modulos) m WHERE m NOT IN ('dp','financeiro')) THEN RAISE EXCEPTION 'modulo_invalido'; END IF;
  IF EXISTS (SELECT 1 FROM companies WHERE cnpj = v_cnpj AND profile_type = 'empresarial') THEN
    RAISE EXCEPTION 'empresa_ja_cadastrada';
  END IF;

  INSERT INTO companies (user_id, profile_type, name, trade_name, cnpj, email, phone, whatsapp,
    cep, logradouro, numero, complemento, bairro, cidade, uf, is_active, status_tenant, trial_iniciado_em, trial_termina_em)
  VALUES (v_uid, 'empresarial', p_razao_social, nullif(p_nome_fantasia,''), v_cnpj, nullif(p_email_empresa,''),
    nullif(p_telefone_empresa,''), NULL, p_cep, p_logradouro, p_numero, p_complemento, p_bairro, p_cidade,
    upper(p_uf), true, 'trial', now(), now() + interval '7 days')
  RETURNING id INTO v_company;

  FOREACH v_slug IN ARRAY p_modulos LOOP
    INSERT INTO company_modules (company_id, module, status, starts_at, ends_at, trial_iniciado_em, trial_termina_em)
    VALUES (v_company, v_slug::app_module, 'trial'::module_status, now(), now() + interval '7 days', now(), now() + interval '7 days')
    ON CONFLICT DO NOTHING;
  END LOOP;

  IF p_criar_unidade AND 'dp' = ANY(p_modulos) THEN
    PERFORM dp_criar_unidade_inicial(v_company);
  END IF;

  INSERT INTO company_invites (company_id, invited_email, role, invited_by, full_name, whatsapp, perfil, modulos, expires_at)
  VALUES (v_company, v_email, 'admin', v_uid, trim(p_gestor_nome), nullif(v_wa,''), 'administrador',
    jsonb_build_object('conta', true, 'pessoas', 'dp' = ANY(p_modulos), 'financeiro', 'financeiro' = ANY(p_modulos)),
    now() + interval '15 days')
  RETURNING id, grupo_id, token INTO v_inv;

  v_existe := EXISTS (SELECT 1 FROM auth.users u WHERE (v_email IS NOT NULL AND lower(u.email) = v_email)
                 OR (length(v_wa) >= 10 AND lower(u.email) = 'wa' || v_wa || '@usuarios.aveto360.local'));

  INSERT INTO concierge_provisionamentos (company_id, invite_id, invite_grupo_id, gestor_nome, gestor_email, gestor_whatsapp, modulos, conta_existente, criado_por)
  VALUES (v_company, v_inv.id, v_inv.grupo_id, trim(p_gestor_nome), v_email, nullif(v_wa,''), p_modulos, v_existe, v_uid);

  RETURN jsonb_build_object('company_id', v_company, 'invite_id', v_inv.id, 'token', v_inv.token, 'conta_existente', v_existe);
END $function$;

-- 3) Ativação com titularidade definida pelo próprio gestor
DROP FUNCTION IF EXISTS public.concierge_ativar(uuid, uuid);

CREATE FUNCTION public.concierge_ativar(
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
    IF 'dp' = ANY(v_p.modulos) THEN v_quer := v_quer || 'pessoas'; END IF;
    IF 'financeiro' = ANY(v_p.modulos) THEN v_quer := v_quer || 'financeiro'; END IF;
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
    v_empresas := v_empresas || v_emp;
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

-- 4) Lote de fichas: inclui o gestor que ainda não criou a senha
DROP FUNCTION IF EXISTS public.dp_ficha_lote_responsaveis(uuid);

CREATE FUNCTION public.dp_ficha_lote_responsaveis(p_importacao_id uuid)
 RETURNS TABLE(user_id uuid, nome text, email text, perfil text, whatsapp text, invite_id uuid, pendente boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO: exclusivo da equipe Aveto.' USING ERRCODE = '42501';
  END IF;
  SELECT i.company_id INTO v_company FROM public.dp_ficha_importacoes i WHERE i.id = p_importacao_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'LOTE_NAO_ENCONTRADO'; END IF;
  RETURN QUERY
    SELECT * FROM (
      SELECT m.user_id,
             coalesce(nullif(btrim(p.full_name), ''), u.email::text) AS nome,
             u.email::text AS email,
             m.role::text AS perfil,
             coalesce(
               nullif(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), ''),
               (SELECT nullif(regexp_replace(coalesce(cp.gestor_whatsapp, ''), '\D', '', 'g'), '')
                  FROM public.concierge_provisionamentos cp
                 WHERE cp.company_id = v_company AND lower(cp.gestor_email) = lower(u.email::text)
                 LIMIT 1)
             ) AS whatsapp,
             NULL::uuid AS invite_id,
             false AS pendente
        FROM public.company_members m
        JOIN auth.users u ON u.id = m.user_id
        LEFT JOIN public.profiles p ON p.user_id = m.user_id
       WHERE m.company_id = v_company
         AND m.situacao = 'ativo'
         AND m.role::text IN ('owner', 'admin')
         AND NOT public.is_super_admin(m.user_id)
      UNION ALL
      SELECT NULL::uuid,
             cp.gestor_nome,
             cp.gestor_email,
             'convite'::text,
             nullif(regexp_replace(coalesce(cp.gestor_whatsapp, ''), '\D', '', 'g'), ''),
             cp.invite_id,
             true
        FROM public.concierge_provisionamentos cp
       WHERE cp.company_id = v_company
         AND cp.modo = 'convite'
         AND cp.ativado_em IS NULL
         AND cp.invite_id IS NOT NULL
    ) r
    ORDER BY r.pendente DESC, (r.perfil = 'owner') DESC, r.nome;
END $function$;

REVOKE ALL ON FUNCTION public.dp_ficha_lote_responsaveis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dp_ficha_lote_responsaveis(uuid) TO authenticated, service_role;

-- 5) Aviso do lote para o gestor que ainda vai criar a senha
CREATE OR REPLACE FUNCTION public.dp_ficha_lote_notificar_convite(p_importacao_id uuid, p_invite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_company uuid;
  v_empresa text;
  v_pend int;
  v_notif uuid;
BEGIN
  IF NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'SEM_PERMISSAO: exclusivo da equipe Aveto.' USING ERRCODE = '42501';
  END IF;
  SELECT i.company_id, coalesce(nullif(btrim(c.trade_name), ''), c.name)
    INTO v_company, v_empresa
    FROM public.dp_ficha_importacoes i JOIN public.companies c ON c.id = i.company_id
   WHERE i.id = p_importacao_id FOR UPDATE OF i;
  IF v_company IS NULL THEN RAISE EXCEPTION 'LOTE_NAO_ENCONTRADO'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.concierge_provisionamentos
     WHERE company_id = v_company AND invite_id = p_invite_id AND modo = 'convite' AND ativado_em IS NULL
  ) THEN
    RAISE EXCEPTION 'CONVITE_INVALIDO: o gestor já ativou o acesso ou o convite não é desta empresa.';
  END IF;

  SELECT count(*) INTO v_pend FROM public.dp_ficha_importacao_itens
   WHERE importacao_id = p_importacao_id AND status IN ('pendente', 'revisar', 'duplicado');
  IF v_pend = 0 THEN RAISE EXCEPTION 'LOTE_SEM_PENDENCIAS: todas as fichas já foram concluídas.'; END IF;

  INSERT INTO public.dp_notificacoes (company_id, user_id, tipo, titulo, descricao, ref_table, ref_id, para_admins)
  VALUES (
    v_company, NULL, 'ficha_lote_pronto',
    'Fichas de registro prontas para conferência',
    'A equipe da Aveto 360 parametrizou ' || v_pend || CASE WHEN v_pend = 1 THEN ' ficha de registro' ELSE ' fichas de registro' END
      || ' de ' || v_empresa || '. Toque para conferir e concluir o cadastro da sua equipe.',
    'dp_ficha_importacoes', p_importacao_id, true
  ) RETURNING id INTO v_notif;

  UPDATE public.dp_ficha_importacoes
     SET organizacao = coalesce(organizacao, '{}'::jsonb) || jsonb_build_object(
       'notificacao', jsonb_build_object('user_id', NULL, 'invite_id', p_invite_id, 'aguardando_acesso', true,
                                         'em', now(), 'por', v_uid, 'fichas', v_pend))
   WHERE id = p_importacao_id;

  RETURN jsonb_build_object('notificacao_id', v_notif, 'fichas', v_pend, 'company_id', v_company);
END $function$;

REVOKE ALL ON FUNCTION public.dp_ficha_lote_notificar_convite(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dp_ficha_lote_notificar_convite(uuid, uuid) TO authenticated, service_role;