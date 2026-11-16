-- Remove SQL dinâmico de duas rotinas chamadas pelo app; mesma autorização e mesmo comportamento.
CREATE OR REPLACE FUNCTION public.dp_cadastro_remuneracao_excluir(p_tabela text, p_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_company uuid; v_motivo text := nullif(btrim(coalesce(p_motivo,'')),'');
BEGIN
  IF p_tabela IS NULL OR p_tabela NOT IN ('dp_cargos','dp_cargo_salarios','dp_beneficios','dp_beneficios_padroes',
                      'dp_adicionais_tempo_servico','dp_colaborador_beneficios') THEN
    RAISE EXCEPTION 'REM_TABELA_NAO_PERMITIDA';
  END IF;

  IF p_tabela = 'dp_cargos' THEN
    SELECT company_id INTO v_company FROM public.dp_cargos WHERE id = p_id AND removido_em IS NULL;
  ELSIF p_tabela = 'dp_cargo_salarios' THEN
    SELECT company_id INTO v_company FROM public.dp_cargo_salarios WHERE id = p_id AND removido_em IS NULL;
  ELSIF p_tabela = 'dp_beneficios' THEN
    SELECT company_id INTO v_company FROM public.dp_beneficios WHERE id = p_id AND removido_em IS NULL;
  ELSIF p_tabela = 'dp_beneficios_padroes' THEN
    SELECT company_id INTO v_company FROM public.dp_beneficios_padroes WHERE id = p_id AND removido_em IS NULL;
  ELSIF p_tabela = 'dp_adicionais_tempo_servico' THEN
    SELECT company_id INTO v_company FROM public.dp_adicionais_tempo_servico WHERE id = p_id AND removido_em IS NULL;
  ELSIF p_tabela = 'dp_colaborador_beneficios' THEN
    SELECT company_id INTO v_company FROM public.dp_colaborador_beneficios WHERE id = p_id AND removido_em IS NULL;
  END IF;
  IF v_company IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  PERFORM private.dp_remuneracao_admin(v_company);

  IF p_tabela = 'dp_cargos' THEN
    IF EXISTS (SELECT 1 FROM public.dp_colaboradores WHERE cargo_id = p_id) THEN
      RAISE EXCEPTION 'REM_CARGO_EM_USO';
    END IF;
  ELSIF p_tabela = 'dp_beneficios' THEN
    IF EXISTS (SELECT 1 FROM public.dp_colaborador_beneficios
                WHERE beneficio_id = p_id AND removido_em IS NULL AND ativo) THEN
      RAISE EXCEPTION 'REM_BENEFICIO_EM_USO';
    END IF;
  END IF;

  IF p_tabela = 'dp_cargos' THEN
    UPDATE public.dp_cargos SET removido_em = now(), removido_por = auth.uid(), removido_motivo = v_motivo WHERE id = p_id;
  ELSIF p_tabela = 'dp_cargo_salarios' THEN
    UPDATE public.dp_cargo_salarios SET removido_em = now(), removido_por = auth.uid(), removido_motivo = v_motivo WHERE id = p_id;
  ELSIF p_tabela = 'dp_beneficios' THEN
    UPDATE public.dp_beneficios SET removido_em = now(), removido_por = auth.uid(), removido_motivo = v_motivo WHERE id = p_id;
  ELSIF p_tabela = 'dp_beneficios_padroes' THEN
    UPDATE public.dp_beneficios_padroes SET removido_em = now(), removido_por = auth.uid(), removido_motivo = v_motivo WHERE id = p_id;
  ELSIF p_tabela = 'dp_adicionais_tempo_servico' THEN
    UPDATE public.dp_adicionais_tempo_servico SET removido_em = now(), removido_por = auth.uid(), removido_motivo = v_motivo WHERE id = p_id;
  ELSIF p_tabela = 'dp_colaborador_beneficios' THEN
    UPDATE public.dp_colaborador_beneficios SET removido_em = now(), removido_por = auth.uid(), removido_motivo = v_motivo WHERE id = p_id;
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.dp_cadastro_remuneracao_excluir(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dp_cadastro_remuneracao_excluir(text, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dp_colaboradores_ajustar_lote(p_company_id uuid, p_dados jsonb, p_ids uuid[] DEFAULT NULL::uuid[], p_cargo_id uuid DEFAULT NULL::uuid, p_somente_ativos boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_chave text;
  v_total integer := 0;
  -- Somente campos de benefícios, adicionais e folga fixa podem ser ajustados em lote.
  v_permitidos constant text[] := ARRAY[
    'adicional_percentual',
    'assiduidade_considera_atestado',
    'assiduidade_criterio',
    'assiduidade_max_atestados',
    'assiduidade_max_atrasos',
    'assiduidade_tolerancia_min',
    'folga_fixa_semana',
    'insalubridade_percentual',
    'periculosidade_percentual',
    'premio_assiduidade',
    'premio_assiduidade_tipo',
    'premio_assiduidade_valor',
    'vale_alimentacao',
    'vale_alimentacao_desconta_atestado',
    'vale_alimentacao_desconta_falta',
    'vale_alimentacao_desconta_ferias',
    'vale_alimentacao_desconta_folga_extra',
    'vale_alimentacao_desconto_tipo',
    'vale_alimentacao_desconto_valor',
    'vale_alimentacao_dia_pagamento',
    'vale_alimentacao_dias_base',
    'vale_alimentacao_dias_corte',
    'vale_alimentacao_dias_origem',
    'vale_alimentacao_periodicidade',
    'vale_alimentacao_valor',
    'vale_transporte',
    'vale_transporte_desconta_atestado',
    'vale_transporte_desconta_falta',
    'vale_transporte_desconta_ferias',
    'vale_transporte_desconta_folga_extra',
    'vale_transporte_dia_pagamento',
    'vale_transporte_dias_corte',
    'vale_transporte_valor_dia'
  ];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF p_company_id IS NULL THEN RAISE EXCEPTION 'COLAB_EMPRESA_OBRIGATORIA'; END IF;
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' OR p_dados = '{}'::jsonb THEN
    RAISE EXCEPTION 'COLAB_DADOS_INVALIDOS';
  END IF;

  IF NOT (
    private.is_company_admin_or_owner(auth.uid(), p_company_id)
    OR EXISTS (SELECT 1 FROM public.companies co WHERE co.id = p_company_id AND co.user_id = auth.uid())
  ) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  IF p_ids IS NULL AND p_cargo_id IS NULL AND p_somente_ativos IS NOT TRUE THEN
    RAISE EXCEPTION 'COLAB_LOTE_SEM_ALVO';
  END IF;

  FOR v_chave IN SELECT jsonb_object_keys(p_dados) LOOP
    IF NOT (v_chave = ANY (v_permitidos)) THEN
      RAISE EXCEPTION 'COLAB_CAMPO_NAO_PERMITIDO';
    END IF;
  END LOOP;

  UPDATE public.dp_colaboradores c
     SET adicional_percentual = CASE WHEN p_dados ? 'adicional_percentual' THEN r.adicional_percentual ELSE c.adicional_percentual END,
         assiduidade_considera_atestado = CASE WHEN p_dados ? 'assiduidade_considera_atestado' THEN r.assiduidade_considera_atestado ELSE c.assiduidade_considera_atestado END,
         assiduidade_criterio = CASE WHEN p_dados ? 'assiduidade_criterio' THEN r.assiduidade_criterio ELSE c.assiduidade_criterio END,
         assiduidade_max_atestados = CASE WHEN p_dados ? 'assiduidade_max_atestados' THEN r.assiduidade_max_atestados ELSE c.assiduidade_max_atestados END,
         assiduidade_max_atrasos = CASE WHEN p_dados ? 'assiduidade_max_atrasos' THEN r.assiduidade_max_atrasos ELSE c.assiduidade_max_atrasos END,
         assiduidade_tolerancia_min = CASE WHEN p_dados ? 'assiduidade_tolerancia_min' THEN r.assiduidade_tolerancia_min ELSE c.assiduidade_tolerancia_min END,
         folga_fixa_semana = CASE WHEN p_dados ? 'folga_fixa_semana' THEN r.folga_fixa_semana ELSE c.folga_fixa_semana END,
         insalubridade_percentual = CASE WHEN p_dados ? 'insalubridade_percentual' THEN r.insalubridade_percentual ELSE c.insalubridade_percentual END,
         periculosidade_percentual = CASE WHEN p_dados ? 'periculosidade_percentual' THEN r.periculosidade_percentual ELSE c.periculosidade_percentual END,
         premio_assiduidade = CASE WHEN p_dados ? 'premio_assiduidade' THEN r.premio_assiduidade ELSE c.premio_assiduidade END,
         premio_assiduidade_tipo = CASE WHEN p_dados ? 'premio_assiduidade_tipo' THEN r.premio_assiduidade_tipo ELSE c.premio_assiduidade_tipo END,
         premio_assiduidade_valor = CASE WHEN p_dados ? 'premio_assiduidade_valor' THEN r.premio_assiduidade_valor ELSE c.premio_assiduidade_valor END,
         vale_alimentacao = CASE WHEN p_dados ? 'vale_alimentacao' THEN r.vale_alimentacao ELSE c.vale_alimentacao END,
         vale_alimentacao_desconta_atestado = CASE WHEN p_dados ? 'vale_alimentacao_desconta_atestado' THEN r.vale_alimentacao_desconta_atestado ELSE c.vale_alimentacao_desconta_atestado END,
         vale_alimentacao_desconta_falta = CASE WHEN p_dados ? 'vale_alimentacao_desconta_falta' THEN r.vale_alimentacao_desconta_falta ELSE c.vale_alimentacao_desconta_falta END,
         vale_alimentacao_desconta_ferias = CASE WHEN p_dados ? 'vale_alimentacao_desconta_ferias' THEN r.vale_alimentacao_desconta_ferias ELSE c.vale_alimentacao_desconta_ferias END,
         vale_alimentacao_desconta_folga_extra = CASE WHEN p_dados ? 'vale_alimentacao_desconta_folga_extra' THEN r.vale_alimentacao_desconta_folga_extra ELSE c.vale_alimentacao_desconta_folga_extra END,
         vale_alimentacao_desconto_tipo = CASE WHEN p_dados ? 'vale_alimentacao_desconto_tipo' THEN r.vale_alimentacao_desconto_tipo ELSE c.vale_alimentacao_desconto_tipo END,
         vale_alimentacao_desconto_valor = CASE WHEN p_dados ? 'vale_alimentacao_desconto_valor' THEN r.vale_alimentacao_desconto_valor ELSE c.vale_alimentacao_desconto_valor END,
         vale_alimentacao_dia_pagamento = CASE WHEN p_dados ? 'vale_alimentacao_dia_pagamento' THEN r.vale_alimentacao_dia_pagamento ELSE c.vale_alimentacao_dia_pagamento END,
         vale_alimentacao_dias_base = CASE WHEN p_dados ? 'vale_alimentacao_dias_base' THEN r.vale_alimentacao_dias_base ELSE c.vale_alimentacao_dias_base END,
         vale_alimentacao_dias_corte = CASE WHEN p_dados ? 'vale_alimentacao_dias_corte' THEN r.vale_alimentacao_dias_corte ELSE c.vale_alimentacao_dias_corte END,
         vale_alimentacao_dias_origem = CASE WHEN p_dados ? 'vale_alimentacao_dias_origem' THEN r.vale_alimentacao_dias_origem ELSE c.vale_alimentacao_dias_origem END,
         vale_alimentacao_periodicidade = CASE WHEN p_dados ? 'vale_alimentacao_periodicidade' THEN r.vale_alimentacao_periodicidade ELSE c.vale_alimentacao_periodicidade END,
         vale_alimentacao_valor = CASE WHEN p_dados ? 'vale_alimentacao_valor' THEN r.vale_alimentacao_valor ELSE c.vale_alimentacao_valor END,
         vale_transporte = CASE WHEN p_dados ? 'vale_transporte' THEN r.vale_transporte ELSE c.vale_transporte END,
         vale_transporte_desconta_atestado = CASE WHEN p_dados ? 'vale_transporte_desconta_atestado' THEN r.vale_transporte_desconta_atestado ELSE c.vale_transporte_desconta_atestado END,
         vale_transporte_desconta_falta = CASE WHEN p_dados ? 'vale_transporte_desconta_falta' THEN r.vale_transporte_desconta_falta ELSE c.vale_transporte_desconta_falta END,
         vale_transporte_desconta_ferias = CASE WHEN p_dados ? 'vale_transporte_desconta_ferias' THEN r.vale_transporte_desconta_ferias ELSE c.vale_transporte_desconta_ferias END,
         vale_transporte_desconta_folga_extra = CASE WHEN p_dados ? 'vale_transporte_desconta_folga_extra' THEN r.vale_transporte_desconta_folga_extra ELSE c.vale_transporte_desconta_folga_extra END,
         vale_transporte_dia_pagamento = CASE WHEN p_dados ? 'vale_transporte_dia_pagamento' THEN r.vale_transporte_dia_pagamento ELSE c.vale_transporte_dia_pagamento END,
         vale_transporte_dias_corte = CASE WHEN p_dados ? 'vale_transporte_dias_corte' THEN r.vale_transporte_dias_corte ELSE c.vale_transporte_dias_corte END,
         vale_transporte_valor_dia = CASE WHEN p_dados ? 'vale_transporte_valor_dia' THEN r.vale_transporte_valor_dia ELSE c.vale_transporte_valor_dia END,
         updated_at = now()
    FROM jsonb_populate_record(NULL::public.dp_colaboradores, p_dados) r
   WHERE c.company_id = p_company_id
     AND c.deleted_at IS NULL
     AND (p_ids IS NULL OR c.id = ANY (p_ids))
     AND (p_cargo_id IS NULL OR c.cargo_id = p_cargo_id)
     AND (p_somente_ativos IS NOT TRUE OR c.data_desligamento IS NULL);

  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END $function$;

REVOKE ALL ON FUNCTION public.dp_colaboradores_ajustar_lote(uuid, jsonb, uuid[], uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dp_colaboradores_ajustar_lote(uuid, jsonb, uuid[], uuid, boolean) TO authenticated, service_role;