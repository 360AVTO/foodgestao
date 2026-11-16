CREATE OR REPLACE FUNCTION private.convite_chave_fone(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH d AS (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') AS v),
  s AS (SELECT CASE WHEN length(v) IN (12, 13) AND left(v, 2) = '55' THEN substr(v, 3) ELSE v END AS v FROM d)
  SELECT CASE WHEN length(v) IN (10, 11) THEN left(v, 2) || right(v, 8) ELSE NULL END FROM s
$$;

CREATE OR REPLACE FUNCTION private.convite_primeiro_nome(p text)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT nullif(upper(extensions.unaccent(split_part(btrim(coalesce(p, '')), ' ', 1))), '')
$$;

CREATE OR REPLACE FUNCTION private.convite_nome_curto(p text)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN nullif(btrim(coalesce(p, '')), '') IS NULL THEN NULL
    WHEN split_part(regexp_replace(btrim(p), '\s+', ' ', 'g'), ' ', 2) = '' THEN upper(split_part(btrim(p), ' ', 1))
    ELSE upper(split_part(regexp_replace(btrim(p), '\s+', ' ', 'g'), ' ', 1)) || ' '
      || upper(left(split_part(regexp_replace(btrim(p), '\s+', ' ', 'g'), ' ', 2), 1)) || '.'
  END
$$;

-- Situação de identidade de um convite (regra única usada pela tela e pelo gatilho).
-- situacao: nova | conta_existente | whatsapp_em_outra_conta | email_outra_pessoa | ja_membro
CREATE OR REPLACE FUNCTION private.company_invite_identidade(
  p_company_ids uuid[], p_email text, p_whatsapp text, p_nome text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_wa text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_login text;
  v_uid uuid;
  v_conta_nome text;
  v_conta_fone text;
  v_conta_login text;
  v_membros jsonb;
  v_outro_uid uuid;
  v_outro_nome text;
  v_outro_login text;
  v_mesmo_nome boolean;
  v_mesmo_fone boolean;
BEGIN
  IF length(v_wa) IN (12, 13) AND left(v_wa, 2) = '55' THEN v_wa := substr(v_wa, 3); END IF;
  v_login := coalesce(v_email, CASE WHEN length(v_wa) IN (10, 11) THEN 'wa' || v_wa || '@usuarios.aveto360.local' END);
  IF v_login IS NULL THEN
    RETURN jsonb_build_object('situacao', 'nova');
  END IF;

  SELECT u.id, u.email INTO v_uid, v_conta_login FROM auth.users u WHERE lower(u.email) = v_login LIMIT 1;

  IF v_uid IS NOT NULL THEN
    SELECT p.full_name, p.phone INTO v_conta_nome, v_conta_fone FROM public.profiles p WHERE p.user_id = v_uid;

    SELECT coalesce(jsonb_agg(jsonb_build_object('empresa', c.name, 'perfil', m.perfil, 'role', m.role) ORDER BY c.name), '[]'::jsonb)
      INTO v_membros
      FROM public.company_members m JOIN public.companies c ON c.id = m.company_id
     WHERE m.user_id = v_uid AND m.company_id = ANY (p_company_ids);

    IF jsonb_array_length(v_membros) > 0 THEN
      RETURN jsonb_build_object('situacao', 'ja_membro', 'conta_nome', private.convite_nome_curto(v_conta_nome), 'membros', v_membros);
    END IF;

    IF v_email IS NOT NULL THEN
      v_mesmo_nome := private.convite_primeiro_nome(v_conta_nome) IS NOT NULL
        AND private.convite_primeiro_nome(v_conta_nome) = private.convite_primeiro_nome(p_nome);
      v_mesmo_fone := private.convite_chave_fone(v_conta_fone) IS NOT NULL
        AND private.convite_chave_fone(v_conta_fone) = private.convite_chave_fone(v_wa);
      IF NOT v_mesmo_nome AND NOT v_mesmo_fone
         AND (private.convite_primeiro_nome(v_conta_nome) IS NOT NULL OR private.convite_chave_fone(v_conta_fone) IS NOT NULL) THEN
        RETURN jsonb_build_object('situacao', 'email_outra_pessoa', 'conta_nome', private.convite_nome_curto(v_conta_nome));
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'situacao', 'conta_existente',
      'conta_nome', private.convite_nome_curto(v_conta_nome),
      'login', CASE WHEN v_email IS NOT NULL THEN 'email' ELSE 'whatsapp' END
    );
  END IF;

  -- Sem conta no login do convite: o WhatsApp já está em outra conta (com e-mail)?
  IF private.convite_chave_fone(v_wa) IS NOT NULL THEN
    SELECT p.user_id, p.full_name, u.email INTO v_outro_uid, v_outro_nome, v_outro_login
      FROM public.profiles p JOIN auth.users u ON u.id = p.user_id
     WHERE private.convite_chave_fone(p.phone) = private.convite_chave_fone(v_wa)
       AND lower(u.email) NOT LIKE '%@usuarios.aveto360.local'
       AND lower(u.email) NOT LIKE '%@portal.360food.local'
     ORDER BY p.created_at
     LIMIT 1;
    IF v_outro_uid IS NOT NULL THEN
      RETURN jsonb_build_object(
        'situacao', 'whatsapp_em_outra_conta',
        'conta_nome', private.convite_nome_curto(v_outro_nome),
        'conta_login_mascarado', regexp_replace(v_outro_login, '^(.{2}).*(@.*)$', '\1***\2')
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('situacao', 'nova');
END $$;

REVOKE ALL ON FUNCTION private.company_invite_identidade(uuid[], text, text, text) FROM PUBLIC, anon, authenticated;

-- Conferência chamada pela tela "Novo Usuário" (só dono/admin de todas as empresas escolhidas).
CREATE OR REPLACE FUNCTION public.company_invite_conferir_identidade(
  p_company_ids uuid[], p_email text, p_whatsapp text, p_nome text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501'; END IF;
  IF p_company_ids IS NULL OR cardinality(p_company_ids) = 0 OR cardinality(p_company_ids) > 50 THEN
    RAISE EXCEPTION 'Empresas inválidas' USING ERRCODE = '22023';
  END IF;
  FOREACH v_cid IN ARRAY p_company_ids LOOP
    IF NOT private.is_company_admin_or_owner(v_uid, v_cid) THEN
      RAISE EXCEPTION 'Sem permissão para convidar nesta empresa' USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN private.company_invite_identidade(p_company_ids, left(p_email, 254), left(p_whatsapp, 20), left(p_nome, 120));
END $$;

REVOKE ALL ON FUNCTION public.company_invite_conferir_identidade(uuid[], text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_invite_conferir_identidade(uuid[], text, text, text) TO authenticated;

-- Gatilho: o servidor recusa convite para membro atual ou e-mail de outra pessoa,
-- mesmo que a tela seja contornada. Parametrização assistida (super admin) não passa aqui.
CREATE OR REPLACE FUNCTION private.company_invites_guard_identidade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb;
  v_sit text;
BEGIN
  IF auth.uid() IS NULL OR public.is_super_admin(auth.uid()) THEN RETURN NEW; END IF;
  v := private.company_invite_identidade(ARRAY[NEW.company_id], NEW.invited_email, NEW.whatsapp, NEW.full_name);
  v_sit := v->>'situacao';
  IF v_sit = 'ja_membro' THEN
    RAISE EXCEPTION 'convite_ja_membro: % já faz parte desta empresa. Para mudar o acesso, edite o usuário na lista.',
      coalesce(v->>'conta_nome', 'Esta pessoa') USING ERRCODE = 'P0001';
  ELSIF v_sit = 'email_outra_pessoa' THEN
    RAISE EXCEPTION 'convite_email_outra_pessoa: Este e-mail já pertence a outra pessoa (%). Use o e-mail de quem está sendo convidado ou deixe o e-mail em branco.',
      coalesce(v->>'conta_nome', 'outra conta') USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION private.company_invites_guard_identidade() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_company_invites_identidade ON public.company_invites;
CREATE TRIGGER trg_company_invites_identidade
  BEFORE INSERT ON public.company_invites
  FOR EACH ROW EXECUTE FUNCTION private.company_invites_guard_identidade();