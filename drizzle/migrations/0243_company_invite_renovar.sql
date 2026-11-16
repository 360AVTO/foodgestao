CREATE OR REPLACE FUNCTION public.company_invite_renovar(_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.company_invites%ROWTYPE;
  v_token text;
  v_total integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'CONVITE_SEM_SESSAO' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv FROM public.company_invites WHERE id = _invite_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONVITE_NAO_ENCONTRADO' USING ERRCODE = 'P0002';
  END IF;

  IF NOT private.is_company_admin_or_owner(v_uid, v_inv.company_id)
     OR (v_inv.role = 'owner' AND NOT private.is_company_owner(v_uid, v_inv.company_id)) THEN
    RAISE EXCEPTION 'CONVITE_SEM_PERMISSAO' USING ERRCODE = '42501';
  END IF;

  IF v_inv.status NOT IN ('pending', 'expired') THEN
    RAISE EXCEPTION 'CONVITE_NAO_RENOVAVEL' USING ERRCODE = '22023';
  END IF;

  UPDATE public.company_invites ci
     SET token = encode(extensions.gen_random_bytes(32), 'hex'),
         expires_at = now() + interval '7 days',
         status = 'pending',
         invited_by = v_uid,
         email_sent_at = NULL,
         whatsapp_sent_at = NULL
   WHERE ci.grupo_id = v_inv.grupo_id
     AND ci.status IN ('pending', 'expired')
     AND private.is_company_admin_or_owner(v_uid, ci.company_id)
     AND (ci.role <> 'owner' OR private.is_company_owner(v_uid, ci.company_id));
  GET DIAGNOSTICS v_total = ROW_COUNT;

  SELECT token INTO v_token FROM public.company_invites WHERE id = _invite_id;

  RETURN jsonb_build_object('invite_id', _invite_id, 'token', v_token, 'empresas', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.company_invite_renovar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_invite_renovar(uuid) TO authenticated, service_role;