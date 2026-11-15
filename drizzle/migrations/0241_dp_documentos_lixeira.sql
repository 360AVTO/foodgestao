CREATE OR REPLACE FUNCTION public.dp_documentos_lixeira(p_company_id uuid)
RETURNS TABLE (
  id uuid,
  titulo text,
  tipo text,
  referencia_data date,
  colaborador_id uuid,
  colaborador_nome text,
  unidade_id uuid,
  unidade_nome text,
  file_path text,
  file_name text,
  mime_type text,
  arquivado_em timestamptz,
  arquivado_por uuid,
  arquivado_por_nome text,
  arquivamento_motivo text,
  restaurar_ate timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL AND NOT private.dp_doc_service_role() THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF NOT private.dp_doc_admin(p_company_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.titulo,
    d.tipo::text,
    d.referencia_data,
    d.colaborador_id,
    c.nome,
    coalesce(d.unidade_id, c.unidade_id),
    u.nome,
    d.file_path,
    d.file_name,
    d.mime_type,
    d.arquivado_em,
    d.arquivado_por,
    p.full_name,
    d.arquivamento_motivo,
    d.arquivado_em + interval '7 days'
  FROM public.dp_documentos d
  LEFT JOIN public.dp_colaboradores c ON c.id = d.colaborador_id
  LEFT JOIN public.dp_unidades u ON u.id = coalesce(d.unidade_id, c.unidade_id)
  LEFT JOIN public.profiles p ON p.user_id = d.arquivado_por
  WHERE d.company_id = p_company_id
    AND d.ciclo_status = 'arquivado'
    AND d.arquivado_em IS NOT NULL
    AND d.arquivado_em >= now() - interval '7 days'
    AND EXISTS (
      SELECT 1 FROM public.dp_documento_eventos e
       WHERE e.documento_id = d.id
         AND e.acao = 'document_deleted'
         AND e.created_at >= d.arquivado_em - interval '5 seconds'
    )
  ORDER BY d.arquivado_em DESC;
END
$function$;

CREATE OR REPLACE FUNCTION public.dp_documento_restaurar(p_documento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_doc public.dp_documentos;
  v_colab_nome text;
  v_unidade_id uuid;
  v_unidade_nome text;
BEGIN
  IF auth.uid() IS NULL AND NOT private.dp_doc_service_role() THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  SELECT * INTO v_doc FROM public.dp_documentos WHERE id = p_documento_id FOR UPDATE;
  IF v_doc.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT private.dp_doc_admin(v_doc.company_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  IF v_doc.arquivado_em IS NULL OR v_doc.ciclo_status <> 'arquivado' THEN
    RETURN jsonb_build_object('modo', 'ja_ativo', 'documento_id', v_doc.id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.dp_documento_eventos e
     WHERE e.documento_id = v_doc.id
       AND e.acao = 'document_deleted'
       AND e.created_at >= v_doc.arquivado_em - interval '5 seconds'
  ) THEN
    RAISE EXCEPTION 'DOC_LIXEIRA_NAO_EXCLUIDO';
  END IF;

  IF v_doc.arquivado_em < now() - interval '7 days' THEN
    RAISE EXCEPTION 'DOC_LIXEIRA_PRAZO_VENCIDO';
  END IF;

  BEGIN
    UPDATE public.dp_documentos
       SET ciclo_status = 'ativo',
           arquivado_em = NULL,
           arquivado_por = NULL,
           arquivamento_motivo = NULL,
           updated_at = now()
     WHERE id = v_doc.id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'DOC_LIXEIRA_VERSAO_ATIVA';
  END;

  SELECT c.nome, coalesce(v_doc.unidade_id, c.unidade_id)
    INTO v_colab_nome, v_unidade_id
    FROM public.dp_colaboradores c WHERE c.id = v_doc.colaborador_id;
  IF v_unidade_id IS NULL THEN v_unidade_id := v_doc.unidade_id; END IF;
  SELECT u.nome INTO v_unidade_nome FROM public.dp_unidades u WHERE u.id = v_unidade_id;

  INSERT INTO public.dp_documento_eventos (
    company_id, documento_id, origem, acao, titulo, tipo, competencia,
    colaborador_id, colaborador_nome, unidade_id, unidade_nome,
    arquivo_anterior, arquivo_novo, motivo, autor_id
  ) VALUES (
    v_doc.company_id, v_doc.id, 'doc', 'restaurado', v_doc.titulo, v_doc.tipo::text,
    to_char(v_doc.referencia_data, 'YYYY-MM'), v_doc.colaborador_id, v_colab_nome,
    v_unidade_id, v_unidade_nome, NULL, v_doc.file_path, 'Restaurado da Lixeira', auth.uid()
  );

  RETURN jsonb_build_object('modo', 'restaurado', 'documento_id', v_doc.id);
END
$function$;

REVOKE ALL ON FUNCTION public.dp_documentos_lixeira(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dp_documento_restaurar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dp_documentos_lixeira(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dp_documento_restaurar(uuid) TO authenticated, service_role;