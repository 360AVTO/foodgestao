CREATE OR REPLACE FUNCTION public.dp_colaborador_salvar(p_dados jsonb, p_id uuid DEFAULT NULL::uuid, p_company_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bloqueadas text[] := ARRAY['id','company_id','user_id','created_at','updated_at','deleted_at','deleted_by','delete_reason','ativo','data_desligamento','desligado_em','desligado_por','motivo_desligamento','acesso_portal_ate','aproval_status','email_portal']::text[];
  -- Colunas que o cadastro pode gravar: lista fixa, sem SQL montado em tempo de execução.
  c_colunas constant text[] := ARRAY['nome','cpf','matricula','cargo','regime','data_admissao','email','telefone','observacoes','unidade_id','cargo_id','sindicato_id','dp_permissions','data_nascimento','whatsapp','folga_fixa_semana','perfil_acesso','possui_folha_ponto','optante_adiantamento','endereco','email_contato','aprovacao_status','aprendiz','sexo','fundamental_concluido','forma_pagamento','salario_base','valor_hora','dependentes_irrf','adicional_percentual','vale_transporte','vale_transporte_valor_dia','vinculo_label','base_salarial','base_horas_mes','base_dias_mes','valor_hora_manual','premio_assiduidade','premio_assiduidade_valor','assiduidade_criterio','assiduidade_tolerancia_min','assiduidade_max_atrasos','premio_assiduidade_tipo','vale_alimentacao','vale_alimentacao_valor','vale_alimentacao_periodicidade','vale_alimentacao_dias_base','vale_alimentacao_desconto_tipo','vale_alimentacao_desconto_valor','vale_alimentacao_dias_origem','assiduidade_considera_atestado','assiduidade_max_atestados','adicional_tempo_servico_manual','adicional_tempo_servico_override','pis_nit','veiculo_proprio','cnh_categoria','cnh_validade','estado_civil','insalubridade_percentual','periculosidade_percentual','vale_alimentacao_dia_pagamento','vale_alimentacao_dias_corte','vale_alimentacao_desconta_falta','vale_alimentacao_desconta_folga_extra','vale_alimentacao_desconta_atestado','vale_alimentacao_desconta_ferias','vale_transporte_dia_pagamento','vale_transporte_dias_corte','vale_transporte_desconta_falta','vale_transporte_desconta_folga_extra','vale_transporte_desconta_atestado','vale_transporte_desconta_ferias','domingos_folga_mes','socio_remuneracao','valor_diaria','setor_id','rg_numero','rg_orgao','rg_uf','rg_emissao','ctps_numero','ctps_serie','ctps_uf','ctps_expedicao','titulo_eleitor','titulo_zona','titulo_secao','reservista','reservista_categoria','nome_pai','nome_mae','nacionalidade','naturalidade','raca_cor','grau_instrucao','deficiencia','origem_cadastro','ficha_importacao_item_id','ferias_controle_inicio','data_base_contagem','nome_social','banco_codigo','banco_nome','agencia','conta','conta_digito','conta_tipo','titular_proprio','titular_nome','titular_cpf','pix_tipo','pix_chave','recebe_em_especie','folha_ponto_dispensa_justificativa','folga_dif_modo','folga_dif_periodicidade','folga_dif_dias','contatos_emergencia','contatos_confirmados_em','contatos_confirmados_por','contatos_solicitado_em','titular_relacao']::text[];
  -- Colunas com gatilhos próprios (UPDATE OF): só entram no comando quando enviadas.
  c_gatilho constant text[] := ARRAY['setor_id','unidade_id','regime','perfil_acesso','vinculo_label']::text[];
  v_atual public.dp_colaboradores;
  v_company uuid;
  v_json jsonb;
  v_merge jsonb;
  v_r public.dp_colaboradores;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;
  IF p_dados IS NULL OR jsonb_typeof(p_dados) <> 'object' THEN
    RAISE EXCEPTION 'COLAB_DADOS_INVALIDOS';
  END IF;

  IF p_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('dp_colaborador:' || p_id::text, 0));
    SELECT * INTO v_atual FROM public.dp_colaboradores WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF v_atual.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    v_company := v_atual.company_id;
  ELSE
    v_company := p_company_id;
    IF v_company IS NULL THEN RAISE EXCEPTION 'COLAB_EMPRESA_OBRIGATORIA'; END IF;
  END IF;

  IF NOT (
    private.is_company_admin_or_owner(auth.uid(), v_company)
    OR EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v_company AND c.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- Campos protegidos ficam fora; nomes de cadastro em CAIXA ALTA.
  v_json := p_dados - v_bloqueadas;
  IF v_json ? 'nome' THEN
    v_json := jsonb_set(v_json, '{nome}', to_jsonb(upper(btrim(COALESCE(v_json->>'nome', '')))));
  END IF;
  IF v_json ? 'nome_mae' AND COALESCE(v_json->>'nome_mae','') <> '' THEN
    v_json := jsonb_set(v_json, '{nome_mae}', to_jsonb(upper(btrim(v_json->>'nome_mae'))));
  END IF;
  IF v_json ? 'nome_pai' AND COALESCE(v_json->>'nome_pai','') <> '' THEN
    v_json := jsonb_set(v_json, '{nome_pai}', to_jsonb(upper(btrim(v_json->>'nome_pai'))));
  END IF;

  IF p_id IS NULL THEN
    v_json := v_json || jsonb_build_object('company_id', v_company, 'ativo', true);
    v_merge := v_json;
  ELSE
    v_merge := to_jsonb(v_atual) || v_json;
  END IF;

  PERFORM private.dp_colaborador_conferir(v_company, v_merge, p_id);

  IF p_id IS NOT NULL AND NOT (v_json ?| c_colunas) THEN
    RETURN p_id;
  END IF;

  -- Insert: só as chaves enviadas; demais colunas recebem o padrão da tabela.
  -- Update: parte do registro atual (travado) e sobrepõe as chaves enviadas.
  IF p_id IS NULL THEN
    v_r := jsonb_populate_record(NULL::public.dp_colaboradores, v_json);
  ELSE
    v_r := jsonb_populate_record(v_atual, v_json);
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.dp_colaboradores (
        company_id, nome, cpf, matricula, cargo, regime, data_admissao, email, telefone, ativo,
        observacoes, unidade_id, cargo_id, sindicato_id, dp_permissions, data_nascimento, whatsapp,
        folga_fixa_semana, perfil_acesso, possui_folha_ponto, optante_adiantamento, endereco,
        email_contato, aprovacao_status, aprendiz, sexo, fundamental_concluido, forma_pagamento,
        salario_base, valor_hora, dependentes_irrf, adicional_percentual, vale_transporte,
        vale_transporte_valor_dia, vinculo_label, base_salarial, base_horas_mes, base_dias_mes,
        valor_hora_manual, premio_assiduidade, premio_assiduidade_valor, assiduidade_criterio,
        assiduidade_tolerancia_min, assiduidade_max_atrasos, premio_assiduidade_tipo, vale_alimentacao,
        vale_alimentacao_valor, vale_alimentacao_periodicidade, vale_alimentacao_dias_base,
        vale_alimentacao_desconto_tipo, vale_alimentacao_desconto_valor, vale_alimentacao_dias_origem,
        assiduidade_considera_atestado, assiduidade_max_atestados, adicional_tempo_servico_manual,
        adicional_tempo_servico_override, pis_nit, veiculo_proprio, cnh_categoria, cnh_validade,
        estado_civil, insalubridade_percentual, periculosidade_percentual, vale_alimentacao_dia_pagamento,
        vale_alimentacao_dias_corte, vale_alimentacao_desconta_falta,
        vale_alimentacao_desconta_folga_extra, vale_alimentacao_desconta_atestado,
        vale_alimentacao_desconta_ferias, vale_transporte_dia_pagamento, vale_transporte_dias_corte,
        vale_transporte_desconta_falta, vale_transporte_desconta_folga_extra,
        vale_transporte_desconta_atestado, vale_transporte_desconta_ferias, domingos_folga_mes,
        socio_remuneracao, valor_diaria, setor_id, rg_numero, rg_orgao, rg_uf, rg_emissao, ctps_numero,
        ctps_serie, ctps_uf, ctps_expedicao, titulo_eleitor, titulo_zona, titulo_secao, reservista,
        reservista_categoria, nome_pai, nome_mae, nacionalidade, naturalidade, raca_cor, grau_instrucao,
        deficiencia, origem_cadastro, ficha_importacao_item_id, ferias_controle_inicio, data_base_contagem,
        nome_social, banco_codigo, banco_nome, agencia, conta, conta_digito, conta_tipo, titular_proprio,
        titular_nome, titular_cpf, pix_tipo, pix_chave, recebe_em_especie,
        folha_ponto_dispensa_justificativa, folga_dif_modo, folga_dif_periodicidade, folga_dif_dias,
        contatos_emergencia, contatos_confirmados_em, contatos_confirmados_por, contatos_solicitado_em,
        titular_relacao
    ) VALUES (
        v_r.company_id, v_r.nome, v_r.cpf, v_r.matricula, v_r.cargo,
        CASE WHEN v_json ? 'regime' THEN v_r.regime ELSE 'clt'::dp_regime_trabalho END, v_r.data_admissao,
        v_r.email, v_r.telefone, CASE WHEN v_json ? 'ativo' THEN v_r.ativo ELSE true END, v_r.observacoes,
        v_r.unidade_id, v_r.cargo_id, v_r.sindicato_id,
        CASE WHEN v_json ? 'dp_permissions' THEN v_r.dp_permissions ELSE '{}'::jsonb END,
        v_r.data_nascimento, v_r.whatsapp, v_r.folga_fixa_semana,
        CASE WHEN v_json ? 'perfil_acesso' THEN v_r.perfil_acesso ELSE 'colaborador'::dp_perfil_acesso END,
        CASE WHEN v_json ? 'possui_folha_ponto' THEN v_r.possui_folha_ponto ELSE false END,
        CASE WHEN v_json ? 'optante_adiantamento' THEN v_r.optante_adiantamento ELSE false END,
        v_r.endereco, v_r.email_contato,
        CASE WHEN v_json ? 'aprovacao_status' THEN v_r.aprovacao_status ELSE 'aprovado'::dp_aprovacao_status END,
        CASE WHEN v_json ? 'aprendiz' THEN v_r.aprendiz ELSE false END, v_r.sexo,
        CASE WHEN v_json ? 'fundamental_concluido' THEN v_r.fundamental_concluido ELSE true END,
        CASE WHEN v_json ? 'forma_pagamento' THEN v_r.forma_pagamento ELSE 'mensalista'::dp_forma_pagamento END,
        v_r.salario_base, v_r.valor_hora,
        CASE WHEN v_json ? 'dependentes_irrf' THEN v_r.dependentes_irrf ELSE 0 END,
        CASE WHEN v_json ? 'adicional_percentual' THEN v_r.adicional_percentual ELSE 0 END,
        CASE WHEN v_json ? 'vale_transporte' THEN v_r.vale_transporte ELSE false END,
        v_r.vale_transporte_valor_dia, v_r.vinculo_label, v_r.base_salarial,
        CASE WHEN v_json ? 'base_horas_mes' THEN v_r.base_horas_mes ELSE 220 END,
        CASE WHEN v_json ? 'base_dias_mes' THEN v_r.base_dias_mes ELSE 30 END,
        CASE WHEN v_json ? 'valor_hora_manual' THEN v_r.valor_hora_manual ELSE false END,
        CASE WHEN v_json ? 'premio_assiduidade' THEN v_r.premio_assiduidade ELSE false END,
        v_r.premio_assiduidade_valor, v_r.assiduidade_criterio,
        CASE WHEN v_json ? 'assiduidade_tolerancia_min' THEN v_r.assiduidade_tolerancia_min ELSE 0 END,
        v_r.assiduidade_max_atrasos,
        CASE WHEN v_json ? 'premio_assiduidade_tipo' THEN v_r.premio_assiduidade_tipo ELSE 'valor'::text END,
        CASE WHEN v_json ? 'vale_alimentacao' THEN v_r.vale_alimentacao ELSE false END,
        v_r.vale_alimentacao_valor,
        CASE WHEN v_json ? 'vale_alimentacao_periodicidade' THEN v_r.vale_alimentacao_periodicidade ELSE 'mensal'::text END,
        CASE WHEN v_json ? 'vale_alimentacao_dias_base' THEN v_r.vale_alimentacao_dias_base ELSE 22 END,
        CASE WHEN v_json ? 'vale_alimentacao_desconto_tipo' THEN v_r.vale_alimentacao_desconto_tipo ELSE 'nenhum'::text END,
        CASE WHEN v_json ? 'vale_alimentacao_desconto_valor' THEN v_r.vale_alimentacao_desconto_valor ELSE 0 END,
        CASE WHEN v_json ? 'vale_alimentacao_dias_origem' THEN v_r.vale_alimentacao_dias_origem ELSE 'jornada'::text END,
        CASE WHEN v_json ? 'assiduidade_considera_atestado' THEN v_r.assiduidade_considera_atestado ELSE true END,
        v_r.assiduidade_max_atestados, v_r.adicional_tempo_servico_manual,
        CASE WHEN v_json ? 'adicional_tempo_servico_override' THEN v_r.adicional_tempo_servico_override ELSE false END,
        v_r.pis_nit, CASE WHEN v_json ? 'veiculo_proprio' THEN v_r.veiculo_proprio ELSE false END,
        v_r.cnh_categoria, v_r.cnh_validade, v_r.estado_civil,
        CASE WHEN v_json ? 'insalubridade_percentual' THEN v_r.insalubridade_percentual ELSE 0 END,
        CASE WHEN v_json ? 'periculosidade_percentual' THEN v_r.periculosidade_percentual ELSE 0 END,
        v_r.vale_alimentacao_dia_pagamento, v_r.vale_alimentacao_dias_corte,
        v_r.vale_alimentacao_desconta_falta, v_r.vale_alimentacao_desconta_folga_extra,
        v_r.vale_alimentacao_desconta_atestado, v_r.vale_alimentacao_desconta_ferias,
        v_r.vale_transporte_dia_pagamento, v_r.vale_transporte_dias_corte,
        v_r.vale_transporte_desconta_falta, v_r.vale_transporte_desconta_folga_extra,
        v_r.vale_transporte_desconta_atestado, v_r.vale_transporte_desconta_ferias, v_r.domingos_folga_mes,
        v_r.socio_remuneracao, v_r.valor_diaria, v_r.setor_id, v_r.rg_numero, v_r.rg_orgao, v_r.rg_uf,
        v_r.rg_emissao, v_r.ctps_numero, v_r.ctps_serie, v_r.ctps_uf, v_r.ctps_expedicao,
        v_r.titulo_eleitor, v_r.titulo_zona, v_r.titulo_secao, v_r.reservista, v_r.reservista_categoria,
        v_r.nome_pai, v_r.nome_mae, v_r.nacionalidade, v_r.naturalidade, v_r.raca_cor, v_r.grau_instrucao,
        v_r.deficiencia,
        CASE WHEN v_json ? 'origem_cadastro' THEN v_r.origem_cadastro ELSE 'manual'::text END,
        v_r.ficha_importacao_item_id, v_r.ferias_controle_inicio, v_r.data_base_contagem, v_r.nome_social,
        v_r.banco_codigo, v_r.banco_nome, v_r.agencia, v_r.conta, v_r.conta_digito, v_r.conta_tipo,
        CASE WHEN v_json ? 'titular_proprio' THEN v_r.titular_proprio ELSE true END, v_r.titular_nome,
        v_r.titular_cpf, v_r.pix_tipo, v_r.pix_chave,
        CASE WHEN v_json ? 'recebe_em_especie' THEN v_r.recebe_em_especie ELSE false END,
        v_r.folha_ponto_dispensa_justificativa, v_r.folga_dif_modo, v_r.folga_dif_periodicidade,
        v_r.folga_dif_dias,
        CASE WHEN v_json ? 'contatos_emergencia' THEN v_r.contatos_emergencia ELSE '[]'::jsonb END,
        v_r.contatos_confirmados_em, v_r.contatos_confirmados_por, v_r.contatos_solicitado_em,
        v_r.titular_relacao
    )
    RETURNING id INTO v_id;
  ELSIF v_json ?| c_gatilho THEN
    UPDATE public.dp_colaboradores c SET
        nome = v_r.nome, cpf = v_r.cpf, matricula = v_r.matricula, cargo = v_r.cargo, regime = v_r.regime,
        data_admissao = v_r.data_admissao, email = v_r.email, telefone = v_r.telefone,
        observacoes = v_r.observacoes, unidade_id = v_r.unidade_id, cargo_id = v_r.cargo_id,
        sindicato_id = v_r.sindicato_id, dp_permissions = v_r.dp_permissions,
        data_nascimento = v_r.data_nascimento, whatsapp = v_r.whatsapp,
        folga_fixa_semana = v_r.folga_fixa_semana, perfil_acesso = v_r.perfil_acesso,
        possui_folha_ponto = v_r.possui_folha_ponto, optante_adiantamento = v_r.optante_adiantamento,
        endereco = v_r.endereco, email_contato = v_r.email_contato,
        aprovacao_status = v_r.aprovacao_status, aprendiz = v_r.aprendiz, sexo = v_r.sexo,
        fundamental_concluido = v_r.fundamental_concluido, forma_pagamento = v_r.forma_pagamento,
        salario_base = v_r.salario_base, valor_hora = v_r.valor_hora,
        dependentes_irrf = v_r.dependentes_irrf, adicional_percentual = v_r.adicional_percentual,
        vale_transporte = v_r.vale_transporte, vale_transporte_valor_dia = v_r.vale_transporte_valor_dia,
        vinculo_label = v_r.vinculo_label, base_salarial = v_r.base_salarial,
        base_horas_mes = v_r.base_horas_mes, base_dias_mes = v_r.base_dias_mes,
        valor_hora_manual = v_r.valor_hora_manual, premio_assiduidade = v_r.premio_assiduidade,
        premio_assiduidade_valor = v_r.premio_assiduidade_valor,
        assiduidade_criterio = v_r.assiduidade_criterio,
        assiduidade_tolerancia_min = v_r.assiduidade_tolerancia_min,
        assiduidade_max_atrasos = v_r.assiduidade_max_atrasos,
        premio_assiduidade_tipo = v_r.premio_assiduidade_tipo, vale_alimentacao = v_r.vale_alimentacao,
        vale_alimentacao_valor = v_r.vale_alimentacao_valor,
        vale_alimentacao_periodicidade = v_r.vale_alimentacao_periodicidade,
        vale_alimentacao_dias_base = v_r.vale_alimentacao_dias_base,
        vale_alimentacao_desconto_tipo = v_r.vale_alimentacao_desconto_tipo,
        vale_alimentacao_desconto_valor = v_r.vale_alimentacao_desconto_valor,
        vale_alimentacao_dias_origem = v_r.vale_alimentacao_dias_origem,
        assiduidade_considera_atestado = v_r.assiduidade_considera_atestado,
        assiduidade_max_atestados = v_r.assiduidade_max_atestados,
        adicional_tempo_servico_manual = v_r.adicional_tempo_servico_manual,
        adicional_tempo_servico_override = v_r.adicional_tempo_servico_override, pis_nit = v_r.pis_nit,
        veiculo_proprio = v_r.veiculo_proprio, cnh_categoria = v_r.cnh_categoria,
        cnh_validade = v_r.cnh_validade, estado_civil = v_r.estado_civil,
        insalubridade_percentual = v_r.insalubridade_percentual,
        periculosidade_percentual = v_r.periculosidade_percentual,
        vale_alimentacao_dia_pagamento = v_r.vale_alimentacao_dia_pagamento,
        vale_alimentacao_dias_corte = v_r.vale_alimentacao_dias_corte,
        vale_alimentacao_desconta_falta = v_r.vale_alimentacao_desconta_falta,
        vale_alimentacao_desconta_folga_extra = v_r.vale_alimentacao_desconta_folga_extra,
        vale_alimentacao_desconta_atestado = v_r.vale_alimentacao_desconta_atestado,
        vale_alimentacao_desconta_ferias = v_r.vale_alimentacao_desconta_ferias,
        vale_transporte_dia_pagamento = v_r.vale_transporte_dia_pagamento,
        vale_transporte_dias_corte = v_r.vale_transporte_dias_corte,
        vale_transporte_desconta_falta = v_r.vale_transporte_desconta_falta,
        vale_transporte_desconta_folga_extra = v_r.vale_transporte_desconta_folga_extra,
        vale_transporte_desconta_atestado = v_r.vale_transporte_desconta_atestado,
        vale_transporte_desconta_ferias = v_r.vale_transporte_desconta_ferias,
        domingos_folga_mes = v_r.domingos_folga_mes, socio_remuneracao = v_r.socio_remuneracao,
        valor_diaria = v_r.valor_diaria, setor_id = v_r.setor_id, rg_numero = v_r.rg_numero,
        rg_orgao = v_r.rg_orgao, rg_uf = v_r.rg_uf, rg_emissao = v_r.rg_emissao,
        ctps_numero = v_r.ctps_numero, ctps_serie = v_r.ctps_serie, ctps_uf = v_r.ctps_uf,
        ctps_expedicao = v_r.ctps_expedicao, titulo_eleitor = v_r.titulo_eleitor,
        titulo_zona = v_r.titulo_zona, titulo_secao = v_r.titulo_secao, reservista = v_r.reservista,
        reservista_categoria = v_r.reservista_categoria, nome_pai = v_r.nome_pai, nome_mae = v_r.nome_mae,
        nacionalidade = v_r.nacionalidade, naturalidade = v_r.naturalidade, raca_cor = v_r.raca_cor,
        grau_instrucao = v_r.grau_instrucao, deficiencia = v_r.deficiencia,
        origem_cadastro = v_r.origem_cadastro, ficha_importacao_item_id = v_r.ficha_importacao_item_id,
        ferias_controle_inicio = v_r.ferias_controle_inicio, data_base_contagem = v_r.data_base_contagem,
        nome_social = v_r.nome_social, banco_codigo = v_r.banco_codigo, banco_nome = v_r.banco_nome,
        agencia = v_r.agencia, conta = v_r.conta, conta_digito = v_r.conta_digito,
        conta_tipo = v_r.conta_tipo, titular_proprio = v_r.titular_proprio,
        titular_nome = v_r.titular_nome, titular_cpf = v_r.titular_cpf, pix_tipo = v_r.pix_tipo,
        pix_chave = v_r.pix_chave, recebe_em_especie = v_r.recebe_em_especie,
        folha_ponto_dispensa_justificativa = v_r.folha_ponto_dispensa_justificativa,
        folga_dif_modo = v_r.folga_dif_modo, folga_dif_periodicidade = v_r.folga_dif_periodicidade,
        folga_dif_dias = v_r.folga_dif_dias, contatos_emergencia = v_r.contatos_emergencia,
        contatos_confirmados_em = v_r.contatos_confirmados_em,
        contatos_confirmados_por = v_r.contatos_confirmados_por,
        contatos_solicitado_em = v_r.contatos_solicitado_em, titular_relacao = v_r.titular_relacao,
        updated_at = now()
     WHERE c.id = p_id
    RETURNING c.id INTO v_id;
  ELSE
    UPDATE public.dp_colaboradores c SET
        nome = v_r.nome, cpf = v_r.cpf, matricula = v_r.matricula, cargo = v_r.cargo,
        data_admissao = v_r.data_admissao, email = v_r.email, telefone = v_r.telefone,
        observacoes = v_r.observacoes, cargo_id = v_r.cargo_id, sindicato_id = v_r.sindicato_id,
        dp_permissions = v_r.dp_permissions, data_nascimento = v_r.data_nascimento,
        whatsapp = v_r.whatsapp, folga_fixa_semana = v_r.folga_fixa_semana,
        possui_folha_ponto = v_r.possui_folha_ponto, optante_adiantamento = v_r.optante_adiantamento,
        endereco = v_r.endereco, email_contato = v_r.email_contato,
        aprovacao_status = v_r.aprovacao_status, aprendiz = v_r.aprendiz, sexo = v_r.sexo,
        fundamental_concluido = v_r.fundamental_concluido, forma_pagamento = v_r.forma_pagamento,
        salario_base = v_r.salario_base, valor_hora = v_r.valor_hora,
        dependentes_irrf = v_r.dependentes_irrf, adicional_percentual = v_r.adicional_percentual,
        vale_transporte = v_r.vale_transporte, vale_transporte_valor_dia = v_r.vale_transporte_valor_dia,
        base_salarial = v_r.base_salarial, base_horas_mes = v_r.base_horas_mes,
        base_dias_mes = v_r.base_dias_mes, valor_hora_manual = v_r.valor_hora_manual,
        premio_assiduidade = v_r.premio_assiduidade,
        premio_assiduidade_valor = v_r.premio_assiduidade_valor,
        assiduidade_criterio = v_r.assiduidade_criterio,
        assiduidade_tolerancia_min = v_r.assiduidade_tolerancia_min,
        assiduidade_max_atrasos = v_r.assiduidade_max_atrasos,
        premio_assiduidade_tipo = v_r.premio_assiduidade_tipo, vale_alimentacao = v_r.vale_alimentacao,
        vale_alimentacao_valor = v_r.vale_alimentacao_valor,
        vale_alimentacao_periodicidade = v_r.vale_alimentacao_periodicidade,
        vale_alimentacao_dias_base = v_r.vale_alimentacao_dias_base,
        vale_alimentacao_desconto_tipo = v_r.vale_alimentacao_desconto_tipo,
        vale_alimentacao_desconto_valor = v_r.vale_alimentacao_desconto_valor,
        vale_alimentacao_dias_origem = v_r.vale_alimentacao_dias_origem,
        assiduidade_considera_atestado = v_r.assiduidade_considera_atestado,
        assiduidade_max_atestados = v_r.assiduidade_max_atestados,
        adicional_tempo_servico_manual = v_r.adicional_tempo_servico_manual,
        adicional_tempo_servico_override = v_r.adicional_tempo_servico_override, pis_nit = v_r.pis_nit,
        veiculo_proprio = v_r.veiculo_proprio, cnh_categoria = v_r.cnh_categoria,
        cnh_validade = v_r.cnh_validade, estado_civil = v_r.estado_civil,
        insalubridade_percentual = v_r.insalubridade_percentual,
        periculosidade_percentual = v_r.periculosidade_percentual,
        vale_alimentacao_dia_pagamento = v_r.vale_alimentacao_dia_pagamento,
        vale_alimentacao_dias_corte = v_r.vale_alimentacao_dias_corte,
        vale_alimentacao_desconta_falta = v_r.vale_alimentacao_desconta_falta,
        vale_alimentacao_desconta_folga_extra = v_r.vale_alimentacao_desconta_folga_extra,
        vale_alimentacao_desconta_atestado = v_r.vale_alimentacao_desconta_atestado,
        vale_alimentacao_desconta_ferias = v_r.vale_alimentacao_desconta_ferias,
        vale_transporte_dia_pagamento = v_r.vale_transporte_dia_pagamento,
        vale_transporte_dias_corte = v_r.vale_transporte_dias_corte,
        vale_transporte_desconta_falta = v_r.vale_transporte_desconta_falta,
        vale_transporte_desconta_folga_extra = v_r.vale_transporte_desconta_folga_extra,
        vale_transporte_desconta_atestado = v_r.vale_transporte_desconta_atestado,
        vale_transporte_desconta_ferias = v_r.vale_transporte_desconta_ferias,
        domingos_folga_mes = v_r.domingos_folga_mes, socio_remuneracao = v_r.socio_remuneracao,
        valor_diaria = v_r.valor_diaria, rg_numero = v_r.rg_numero, rg_orgao = v_r.rg_orgao,
        rg_uf = v_r.rg_uf, rg_emissao = v_r.rg_emissao, ctps_numero = v_r.ctps_numero,
        ctps_serie = v_r.ctps_serie, ctps_uf = v_r.ctps_uf, ctps_expedicao = v_r.ctps_expedicao,
        titulo_eleitor = v_r.titulo_eleitor, titulo_zona = v_r.titulo_zona,
        titulo_secao = v_r.titulo_secao, reservista = v_r.reservista,
        reservista_categoria = v_r.reservista_categoria, nome_pai = v_r.nome_pai, nome_mae = v_r.nome_mae,
        nacionalidade = v_r.nacionalidade, naturalidade = v_r.naturalidade, raca_cor = v_r.raca_cor,
        grau_instrucao = v_r.grau_instrucao, deficiencia = v_r.deficiencia,
        origem_cadastro = v_r.origem_cadastro, ficha_importacao_item_id = v_r.ficha_importacao_item_id,
        ferias_controle_inicio = v_r.ferias_controle_inicio, data_base_contagem = v_r.data_base_contagem,
        nome_social = v_r.nome_social, banco_codigo = v_r.banco_codigo, banco_nome = v_r.banco_nome,
        agencia = v_r.agencia, conta = v_r.conta, conta_digito = v_r.conta_digito,
        conta_tipo = v_r.conta_tipo, titular_proprio = v_r.titular_proprio,
        titular_nome = v_r.titular_nome, titular_cpf = v_r.titular_cpf, pix_tipo = v_r.pix_tipo,
        pix_chave = v_r.pix_chave, recebe_em_especie = v_r.recebe_em_especie,
        folha_ponto_dispensa_justificativa = v_r.folha_ponto_dispensa_justificativa,
        folga_dif_modo = v_r.folga_dif_modo, folga_dif_periodicidade = v_r.folga_dif_periodicidade,
        folga_dif_dias = v_r.folga_dif_dias, contatos_emergencia = v_r.contatos_emergencia,
        contatos_confirmados_em = v_r.contatos_confirmados_em,
        contatos_confirmados_por = v_r.contatos_confirmados_por,
        contatos_solicitado_em = v_r.contatos_solicitado_em, titular_relacao = v_r.titular_relacao,
        updated_at = now()
     WHERE c.id = p_id
    RETURNING c.id INTO v_id;
  END IF;

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.dp_colaborador_perfil_atualizar(p_dados jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_permitidas text[] := ARRAY['telefone','whatsapp','email_contato','endereco','pix_tipo','pix_chave','titular_nome','titular_cpf','banco_codigo','banco_nome','agencia','conta','conta_digito','conta_tipo']::text[];
  v_colab uuid;
  v_atual public.dp_colaboradores;
  v_json jsonb := '{}'::jsonb;
  v_chave text;
  v_r public.dp_colaboradores;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  v_colab := public.dp_colaborador_ativo_of(auth.uid());
  IF v_colab IS NULL THEN RAISE EXCEPTION 'sem_acesso_portal'; END IF;

  SELECT * INTO v_atual FROM public.dp_colaboradores WHERE id = v_colab FOR UPDATE;

  FOREACH v_chave IN ARRAY v_permitidas LOOP
    IF p_dados ? v_chave THEN
      v_json := v_json || jsonb_build_object(v_chave, p_dados -> v_chave);
    END IF;
  END LOOP;

  IF v_json = '{}'::jsonb THEN RETURN v_colab; END IF;
  v_json := v_json || jsonb_build_object('titular_proprio', true);

  PERFORM private.dp_colaborador_conferir(v_atual.company_id, to_jsonb(v_atual) || v_json, v_colab);

  -- Colunas fixas (sem SQL montado em tempo de execução).
  v_r := jsonb_populate_record(v_atual, v_json);
  UPDATE public.dp_colaboradores c SET
        telefone = v_r.telefone, whatsapp = v_r.whatsapp, email_contato = v_r.email_contato,
        endereco = v_r.endereco, pix_tipo = v_r.pix_tipo, pix_chave = v_r.pix_chave,
        titular_nome = v_r.titular_nome, titular_cpf = v_r.titular_cpf, banco_codigo = v_r.banco_codigo,
        banco_nome = v_r.banco_nome, agencia = v_r.agencia, conta = v_r.conta,
        conta_digito = v_r.conta_digito, conta_tipo = v_r.conta_tipo,
        titular_proprio = v_r.titular_proprio,
        updated_at = now()
   WHERE c.id = v_colab;

  RETURN v_colab;
END $function$;

REVOKE ALL ON FUNCTION public.dp_colaborador_salvar(jsonb, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dp_colaborador_salvar(jsonb, uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.dp_colaborador_perfil_atualizar(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dp_colaborador_perfil_atualizar(jsonb) TO authenticated, service_role;

DROP POLICY IF EXISTS "membros leem operacao de feriado" ON public.dp_unidade_feriado_operacao;
CREATE POLICY "membros leem operacao de feriado" ON public.dp_unidade_feriado_operacao
  FOR SELECT TO authenticated
  USING (private.is_company_member((SELECT auth.uid()), company_id));

DROP POLICY IF EXISTS "Catálogo legível" ON public.plan_features;
CREATE POLICY "Catálogo legível" ON public.plan_features
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.plans p WHERE p.id = plan_features.plan_id AND p.is_active AND p.is_public)
         OR public.is_super_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "Catálogo legível" ON public.plan_limits;
CREATE POLICY "Catálogo legível" ON public.plan_limits
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.plans p WHERE p.id = plan_limits.plan_id AND p.is_active AND p.is_public)
         OR public.is_super_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS "Faixas de volume visíveis" ON public.plan_volume_tiers;
CREATE POLICY "Faixas de volume visíveis" ON public.plan_volume_tiers
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.plans p WHERE p.id = plan_volume_tiers.plan_id AND p.is_active AND p.is_public)
         OR public.is_super_admin((SELECT auth.uid())));