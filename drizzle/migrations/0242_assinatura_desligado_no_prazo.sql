-- Quem pode ASSINAR pelo portal: vínculo ativo, aviso prévio após o último
-- dia trabalhado e desligado dentro da janela de acesso (acesso_portal_ate).
-- Empresa em modo somente leitura não assina (mantém o comportamento anterior).
CREATE OR REPLACE FUNCTION public.dp_colaborador_assinatura_of(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT d.colaborador_id
  FROM private.dp_portal_decisao(_user_id) d
  WHERE _user_id IS NOT NULL
    AND (
      _user_id = auth.uid()
      OR current_setting('request.jwt.claim.role', true) = 'service_role'
      OR auth.role() = 'service_role'
    )
    AND d.estado IN ('ativo', 'aviso_pos_trabalho', 'desligado_no_prazo');
$function$;

REVOKE ALL ON FUNCTION public.dp_colaborador_assinatura_of(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dp_colaborador_assinatura_of(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dp_documento_aceitar(_documento_id uuid, _user_agent text DEFAULT NULL::text, _ip text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_colab uuid;
  v_colab_company uuid;
  v_doc public.dp_documentos;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado';
  END IF;

  v_colab := public.dp_colaborador_assinatura_of(v_uid);
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

  SELECT id INTO v_id
    FROM public.dp_documento_aceites
   WHERE documento_id = _documento_id
     AND aceito_por = v_uid
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.dp_documento_aceites (
    company_id, colaborador_id, documento_id, modelo, modelo_versao,
    conteudo_hash, aceito_por, ip, user_agent, documento_versao, hash_origem
  ) VALUES (
    v_doc.company_id, v_colab, _documento_id, v_doc.tipo::text,
    'v' || COALESCE(v_doc.versao, 1)::text,
    v_doc.arquivo_sha256, v_uid, NULLIF(btrim(COALESCE(_ip, '')), ''),
    NULLIF(left(COALESCE(_user_agent, ''), 500), ''),
    COALESCE(v_doc.versao, 1), 'sha256_conteudo'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

-- Leitura do arquivo no portal segue a mesma regra da lista de documentos
-- (dp_colaborador_of: inclui desligado no prazo e aviso após o último dia).
ALTER POLICY dp_doc_bucket_read_autorizado ON storage.objects
USING (
  (bucket_id = 'dp-documentos'::text) AND (
    private.is_company_admin_or_owner(auth.uid(), try_cast_uuid(split_part(name, '/'::text, 1)))
    OR is_super_admin(auth.uid())
    OR (EXISTS (
      SELECT 1 FROM public.dp_documentos d
      WHERE ((d.file_path = objects.name) OR (d.comprovante_file_path = objects.name))
        AND d.company_id = try_cast_uuid(split_part(objects.name, '/'::text, 1))
        AND d.colaborador_id IS NOT NULL
        AND d.colaborador_id = public.dp_colaborador_of(auth.uid())
        AND d.tipo <> 'disciplinar'::dp_documento_tipo
        AND d.ciclo_status = ANY (ARRAY['ativo'::text, 'arquivado'::text])
    ))
  )
);

ALTER POLICY dp_doc_bucket_legacy_read ON storage.objects
USING (
  (bucket_id = 'dp-documentos'::text)
  AND (name ~~ 'documentos/%'::text)
  AND (EXISTS (
    SELECT 1 FROM public.dp_documentos d
    WHERE d.file_path = objects.name
      AND (
        private.is_company_admin_or_owner(auth.uid(), d.company_id)
        OR is_super_admin(auth.uid())
        OR ((d.colaborador_id = public.dp_colaborador_of(auth.uid())) AND (d.tipo <> 'disciplinar'::dp_documento_tipo))
      )
  ))
);