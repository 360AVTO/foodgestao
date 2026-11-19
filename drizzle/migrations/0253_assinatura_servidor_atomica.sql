CREATE OR REPLACE FUNCTION public.dp_documento_aceitar_servidor(
  _user_id uuid,
  _documento_id uuid,
  _assinatura_imagem text,
  _termo_versao text,
  _user_agent text DEFAULT NULL,
  _ip text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_colab uuid;
  v_colab_company uuid;
  v_doc public.dp_documentos;
  v_id uuid;
  v_img text;
BEGIN
  IF NOT private.dp_doc_service_role() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado';
  END IF;
  IF _assinatura_imagem IS NULL
     OR left(_assinatura_imagem, 22) <> 'data:image/png;base64,'
     OR length(_assinatura_imagem) > 400000 THEN
    RAISE EXCEPTION 'assinatura_ausente';
  END IF;

  v_colab := public.dp_colaborador_assinatura_of(_user_id);
  IF v_colab IS NULL THEN
    RAISE EXCEPTION 'sem_acesso_portal';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_documento_id::text, 0));

  SELECT * INTO v_doc FROM public.dp_documentos WHERE id = _documento_id;
  IF v_doc.id IS NULL
     OR v_doc.colaborador_id IS DISTINCT FROM v_colab
     OR v_doc.arquivado_em IS NOT NULL
     OR COALESCE(v_doc.ciclo_status, 'ativo') <> 'ativo'
     OR COALESCE(v_doc.aprovacao_status::text, 'aprovado') <> 'aprovado' THEN
    RAISE EXCEPTION 'documento_indisponivel';
  END IF;

  SELECT company_id INTO v_colab_company FROM public.dp_colaboradores WHERE id = v_colab;
  IF v_colab_company IS DISTINCT FROM v_doc.company_id THEN
    RAISE EXCEPTION 'documento_indisponivel';
  END IF;

  IF COALESCE(v_doc.exige_aceite, false) = false THEN
    RAISE EXCEPTION 'documento_nao_exige_aceite';
  END IF;
  IF v_doc.file_path IS NULL THEN
    RAISE EXCEPTION 'documento_sem_arquivo';
  END IF;
  IF v_doc.arquivo_sha256 IS NULL OR length(v_doc.arquivo_sha256) <> 64 THEN
    RAISE EXCEPTION 'conteudo_nao_conferido';
  END IF;

  -- Idempotente: devolve o aceite existente (e completa a imagem de registros antigos).
  SELECT id, assinatura_imagem INTO v_id, v_img
    FROM public.dp_documento_aceites
   WHERE documento_id = _documento_id
     AND aceito_por = _user_id
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    IF v_img IS NULL THEN
      UPDATE public.dp_documento_aceites SET assinatura_imagem = _assinatura_imagem WHERE id = v_id;
    END IF;
    RETURN v_id;
  END IF;

  -- Ninguém assina antes de aceitar o Termo do Portal na versão vigente.
  IF _termo_versao IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.dp_documento_aceites t
     WHERE t.colaborador_id = v_colab
       AND t.modelo = 'termo_portal'
       AND t.modelo_versao = _termo_versao
  ) THEN
    RAISE EXCEPTION 'termo_portal_pendente';
  END IF;

  INSERT INTO public.dp_documento_aceites (
    company_id, colaborador_id, documento_id, modelo, modelo_versao,
    conteudo_hash, aceito_por, ip, user_agent, documento_versao, hash_origem,
    assinatura_imagem
  ) VALUES (
    v_doc.company_id, v_colab, _documento_id, v_doc.tipo::text,
    'v' || COALESCE(v_doc.versao, 1)::text,
    v_doc.arquivo_sha256, _user_id, NULLIF(btrim(COALESCE(_ip, '')), ''),
    NULLIF(left(COALESCE(_user_agent, ''), 500), ''),
    COALESCE(v_doc.versao, 1), 'sha256_conteudo',
    _assinatura_imagem
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.dp_documento_aceitar_servidor(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dp_documento_aceitar_servidor(uuid, uuid, text, text, text, text) TO service_role;

DROP FUNCTION IF EXISTS public.dp_recibo_assinar_externo(uuid, text, text, text);

CREATE FUNCTION public.dp_recibo_assinar_externo(
  p_recibo_id uuid,
  p_hash text,
  p_ip text,
  p_user_agent text,
  p_assinatura_imagem text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_recibo public.dp_recibos;
  v_agora timestamptz := now();
BEGIN
  IF NOT private.dp_doc_service_role() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('dp_recibo:' || p_recibo_id::text, 0));
  SELECT * INTO v_recibo FROM public.dp_recibos WHERE id = p_recibo_id FOR UPDATE;
  IF v_recibo.id IS NULL OR v_recibo.cancelado_em IS NOT NULL THEN RAISE EXCEPTION 'RECIBO_INDISPONIVEL'; END IF;
  IF v_recibo.canal_assinatura <> 'whatsapp' THEN RAISE EXCEPTION 'RECIBO_CANAL_INVALIDO'; END IF;
  IF v_recibo.assinado_em IS NOT NULL THEN RETURN v_recibo.assinado_em; END IF;
  IF p_hash IS NULL OR length(p_hash) <> 64 THEN RAISE EXCEPTION 'RECIBO_HASH_INVALIDO'; END IF;
  IF p_assinatura_imagem IS NULL
     OR left(p_assinatura_imagem, 22) <> 'data:image/png;base64,'
     OR length(p_assinatura_imagem) > 400000 THEN
    RAISE EXCEPTION 'RECIBO_ASSINATURA_AUSENTE';
  END IF;

  -- Assinatura e imagem na mesma gravação; o link continua valendo para a
  -- pessoa reabrir e baixar a via quitada (só o cancelamento o encerra).
  UPDATE public.dp_recibos
     SET assinado_em = v_agora,
         assinado_ip = nullif(trim(coalesce(p_ip, '')), ''),
         assinado_user_agent = nullif(left(coalesce(p_user_agent, ''), 400), ''),
         assinado_hash = p_hash,
         assinado_confirmacao = jsonb_build_object(
           'metodo', 'cpf', 'canal', 'whatsapp', 'declaracao', 'Li e concordo com o recibo'
         ),
         assinatura_imagem = COALESCE(assinatura_imagem, p_assinatura_imagem),
         updated_at = now()
   WHERE id = v_recibo.id;
  RETURN v_agora;
END $$;

REVOKE ALL ON FUNCTION public.dp_recibo_assinar_externo(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dp_recibo_assinar_externo(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION private.dp_recibo_sincronizar_aceite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  UPDATE public.dp_recibos
     SET assinado_em = COALESCE(assinado_em, NEW.aceito_em),
         assinado_ip = COALESCE(assinado_ip, NEW.ip),
         assinado_user_agent = COALESCE(assinado_user_agent, NEW.user_agent),
         assinado_hash = COALESCE(assinado_hash, NEW.conteudo_hash),
         assinado_confirmacao = COALESCE(
           assinado_confirmacao,
           jsonb_build_object('metodo', 'portal', 'canal', 'portal', 'aceite_id', NEW.id)
         ),
         assinatura_imagem = COALESCE(assinatura_imagem, NEW.assinatura_imagem),
         updated_at = now()
   WHERE documento_id = NEW.documento_id
     AND colaborador_id = NEW.colaborador_id
     AND cancelado_em IS NULL;
  RETURN NEW;
END $$;