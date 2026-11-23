CREATE OR REPLACE FUNCTION public.dp_ficha_aplicar(p_item_id uuid, p_dados jsonb, p_dados_extraidos jsonb DEFAULT '{}'::jsonb, p_campos text[] DEFAULT NULL::text[], p_atualizar_existente boolean DEFAULT false, p_cargo_id uuid DEFAULT NULL::uuid, p_unidade_id uuid DEFAULT NULL::uuid, p_setor_id uuid DEFAULT NULL::uuid, p_turno_id uuid DEFAULT NULL::uuid, p_regime text DEFAULT NULL::text, p_forma_pagamento text DEFAULT NULL::text, p_possui_folha_ponto boolean DEFAULT NULL::boolean, p_optante_adiantamento boolean DEFAULT NULL::boolean, p_jornada jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c_allow constant text[] := array[
    'nome','cpf','matricula','data_nascimento','data_admissao','sexo','telefone',
    'whatsapp','email_contato','estado_civil','endereco','cargo','salario_base',
    'rg_numero','rg_orgao','rg_uf','rg_emissao','ctps_numero','ctps_serie',
    'ctps_uf','ctps_expedicao','titulo_eleitor','titulo_zona','titulo_secao',
    'reservista','reservista_categoria','nome_pai','nome_mae','nacionalidade',
    'naturalidade','raca_cor','grau_instrucao','deficiencia','folha_ponto_dispensa_justificativa'
  ];
  c_proibidos constant text[] := array[
    'id','user_id','company_id','perfil_acesso','dp_permissions','permissions',
    'deleted_at','ativo','email_portal','origem_cadastro','ficha_importacao_item_id',
    'created_at','updated_at'
  ];
  v_item public.dp_ficha_importacao_itens;
  v_imp public.dp_ficha_importacoes;
  v_importacao_id uuid;
  v_company uuid;
  v_nome text;
  v_cpf text;
  v_chave text;
  v_src jsonb := '{}'::jsonb;
  v_val jsonb;
  v_r public.dp_colaboradores;
  v_colab uuid;
  v_config uuid;
  v_configs int;
  v_dia jsonb;
  v_dows int[] := array[]::int[];
  v_dow int;
  v_trab boolean;
  v_entrada text;
  v_saida text;
  v_intervalo int;
  v_folga_fixa smallint := null;
  v_folga_variavel boolean := true;
  v_status text;
  v_afetadas int;
  v_criados int;
  v_atualizados int;
  v_pendentes int;
  v_total int;
  v_prontos int;
begin
  if p_item_id is null then
    raise exception 'Informe a ficha a aplicar.' using errcode = '22023';
  end if;
  if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
    raise exception 'Dados da ficha inválidos.' using errcode = '22023';
  end if;

  foreach v_chave in array c_proibidos loop
    if p_dados ? v_chave then
      raise exception 'Campo % não pode ser enviado na aplicação da ficha.', v_chave using errcode = '42501';
    end if;
  end loop;

  if p_jornada is not null then
    if jsonb_typeof(p_jornada) <> 'object' or not (p_jornada ? 'dias')
       or jsonb_typeof(p_jornada -> 'dias') <> 'array'
       or jsonb_array_length(p_jornada -> 'dias') = 0 then
      raise exception 'Jornada da ficha em formato inválido.' using errcode = '22023';
    end if;
  end if;

  select * into v_item from public.dp_ficha_importacao_itens where id = p_item_id;
  if not found then
    raise exception 'Ficha não encontrada ou sem permissão.' using errcode = '42501';
  end if;
  v_importacao_id := v_item.importacao_id;
  v_company := v_item.company_id;

  if auth.uid() is null or v_company is null
     or not public.tem_permissao(v_company, 'dp.colaboradores', 'inclusao') then
    raise exception 'Você não tem permissão para cadastrar colaboradores nesta empresa.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('dp_ficha_importacao:' || v_importacao_id::text, 0));

  select * into v_imp from public.dp_ficha_importacoes where id = v_importacao_id for update;
  if not found then
    raise exception 'Importação não encontrada ou sem permissão.' using errcode = '42501';
  end if;

  select * into v_item from public.dp_ficha_importacao_itens where id = p_item_id for update;
  if not found then
    raise exception 'Ficha não encontrada ou sem permissão.' using errcode = '42501';
  end if;
  if v_item.importacao_id <> v_importacao_id then
    raise exception 'A ficha mudou de importação durante a gravação.' using errcode = '40001';
  end if;
  v_company := v_item.company_id;
  if v_company is null or v_imp.company_id <> v_company then
    raise exception 'A ficha não pertence à empresa da importação.' using errcode = '42501';
  end if;

  if v_item.status in ('criado','atualizado') and v_item.colaborador_id is not null then
    if not exists (select 1 from public.dp_colaboradores where id = v_item.colaborador_id and company_id = v_company) then
      raise exception 'Cadastro da ficha não pertence a esta empresa.' using errcode = '42501';
    end if;
    return jsonb_build_object('colaborador_id', v_item.colaborador_id, 'status', v_item.status,
      'ja_aplicado', true, 'arquivo_path', v_item.arquivo_path,
      'pagina_inicio', v_item.pagina_inicio, 'pagina_fim', v_item.pagina_fim);
  end if;

  if p_cargo_id is not null and not exists (select 1 from public.dp_cargos where id = p_cargo_id and company_id = v_company) then
    raise exception 'Cargo de outra empresa.' using errcode = '42501';
  end if;
  if p_unidade_id is not null and not exists (select 1 from public.dp_unidades where id = p_unidade_id and company_id = v_company) then
    raise exception 'Unidade de outra empresa.' using errcode = '42501';
  end if;
  if p_setor_id is not null and not exists (select 1 from public.dp_setores where id = p_setor_id and company_id = v_company) then
    raise exception 'Setor de outra empresa.' using errcode = '42501';
  end if;
  if p_turno_id is not null and not exists (select 1 from public.dp_turnos where id = p_turno_id and company_id = v_company) then
    raise exception 'Turno de outra empresa.' using errcode = '42501';
  end if;

  foreach v_chave in array c_allow loop
    if not (p_dados ? v_chave) then continue; end if;
    v_val := p_dados -> v_chave;
    if v_val is null or jsonb_typeof(v_val) = 'null' then continue; end if;
    if jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '' then continue; end if;
    if jsonb_typeof(v_val) = 'object' and v_val = '{}'::jsonb then continue; end if;
    if p_atualizar_existente and p_campos is not null and not (v_chave = any(p_campos)) then continue; end if;
    v_src := v_src || jsonb_build_object(v_chave, v_val);
  end loop;

  v_nome := nullif(btrim(coalesce(p_dados ->> 'nome', '')), '');
  v_cpf := nullif(regexp_replace(coalesce(p_dados ->> 'cpf', ''), '\D', '', 'g'), '');
  if p_atualizar_existente then
    if v_src ? 'nome' then
      if v_nome is null then raise exception 'Informe o nome do colaborador.' using errcode = '22023'; end if;
      v_src := v_src || jsonb_build_object('nome', v_nome);
    end if;
    if v_src ? 'cpf' then
      if v_cpf is null or length(v_cpf) <> 11 then raise exception 'Informe um CPF com 11 dígitos.' using errcode = '22023'; end if;
      v_src := v_src || jsonb_build_object('cpf', v_cpf);
    end if;
  else
    if v_nome is null then raise exception 'Informe o nome do colaborador.' using errcode = '22023'; end if;
    if v_cpf is null or length(v_cpf) <> 11 then raise exception 'Informe um CPF com 11 dígitos.' using errcode = '22023'; end if;
    v_src := v_src || jsonb_build_object('nome', v_nome, 'cpf', v_cpf);
  end if;

  if p_cargo_id is not null then v_src := v_src || jsonb_build_object('cargo_id', p_cargo_id); end if;
  if p_unidade_id is not null then v_src := v_src || jsonb_build_object('unidade_id', p_unidade_id); end if;
  if p_setor_id is not null then v_src := v_src || jsonb_build_object('setor_id', p_setor_id); end if;
  if p_regime is not null then v_src := v_src || jsonb_build_object('regime', p_regime); end if;
  if p_forma_pagamento is not null then v_src := v_src || jsonb_build_object('forma_pagamento', p_forma_pagamento); end if;
  if p_possui_folha_ponto is not null then
    v_src := v_src || jsonb_build_object('possui_folha_ponto', p_possui_folha_ponto);
  elsif not p_atualizar_existente then
    v_src := v_src || jsonb_build_object('possui_folha_ponto', false);
  end if;
  if p_optante_adiantamento is not null then
    v_src := v_src || jsonb_build_object('optante_adiantamento', p_optante_adiantamento);
  elsif not p_atualizar_existente then
    v_src := v_src || jsonb_build_object('optante_adiantamento', false);
  end if;
  v_src := v_src || jsonb_build_object('ficha_importacao_item_id', v_item.id);

  if p_atualizar_existente then
    if v_item.colaborador_existente_id is null then raise exception 'A ficha não aponta para um cadastro existente.' using errcode = '22023'; end if;
    select id into v_colab from public.dp_colaboradores
      where id = v_item.colaborador_existente_id and company_id = v_company for update;
    if v_colab is null then raise exception 'Cadastro existente não encontrado nesta empresa.' using errcode = '42501'; end if;

    -- Colunas fixas (sem SQL montado em tempo de execução); só as chaves
    -- presentes em v_src (lista permitida) são alteradas.
    v_r := jsonb_populate_record(null::public.dp_colaboradores, v_src);
    begin
      if v_src ?| array['regime','unidade_id','setor_id'] then
        update public.dp_colaboradores c set
        nome = case when v_src ? 'nome' then v_r.nome else c.nome end,
        cpf = case when v_src ? 'cpf' then v_r.cpf else c.cpf end,
        matricula = case when v_src ? 'matricula' then v_r.matricula else c.matricula end,
        data_nascimento = case when v_src ? 'data_nascimento' then v_r.data_nascimento else c.data_nascimento end,
        data_admissao = case when v_src ? 'data_admissao' then v_r.data_admissao else c.data_admissao end,
        sexo = case when v_src ? 'sexo' then v_r.sexo else c.sexo end,
        telefone = case when v_src ? 'telefone' then v_r.telefone else c.telefone end,
        whatsapp = case when v_src ? 'whatsapp' then v_r.whatsapp else c.whatsapp end,
        email_contato = case when v_src ? 'email_contato' then v_r.email_contato else c.email_contato end,
        estado_civil = case when v_src ? 'estado_civil' then v_r.estado_civil else c.estado_civil end,
        endereco = case when v_src ? 'endereco' then v_r.endereco else c.endereco end,
        cargo = case when v_src ? 'cargo' then v_r.cargo else c.cargo end,
        salario_base = case when v_src ? 'salario_base' then v_r.salario_base else c.salario_base end,
        rg_numero = case when v_src ? 'rg_numero' then v_r.rg_numero else c.rg_numero end,
        rg_orgao = case when v_src ? 'rg_orgao' then v_r.rg_orgao else c.rg_orgao end,
        rg_uf = case when v_src ? 'rg_uf' then v_r.rg_uf else c.rg_uf end,
        rg_emissao = case when v_src ? 'rg_emissao' then v_r.rg_emissao else c.rg_emissao end,
        ctps_numero = case when v_src ? 'ctps_numero' then v_r.ctps_numero else c.ctps_numero end,
        ctps_serie = case when v_src ? 'ctps_serie' then v_r.ctps_serie else c.ctps_serie end,
        ctps_uf = case when v_src ? 'ctps_uf' then v_r.ctps_uf else c.ctps_uf end,
        ctps_expedicao = case when v_src ? 'ctps_expedicao' then v_r.ctps_expedicao else c.ctps_expedicao end,
        titulo_eleitor = case when v_src ? 'titulo_eleitor' then v_r.titulo_eleitor else c.titulo_eleitor end,
        titulo_zona = case when v_src ? 'titulo_zona' then v_r.titulo_zona else c.titulo_zona end,
        titulo_secao = case when v_src ? 'titulo_secao' then v_r.titulo_secao else c.titulo_secao end,
        reservista = case when v_src ? 'reservista' then v_r.reservista else c.reservista end,
        reservista_categoria = case when v_src ? 'reservista_categoria' then v_r.reservista_categoria else c.reservista_categoria end,
        nome_pai = case when v_src ? 'nome_pai' then v_r.nome_pai else c.nome_pai end,
        nome_mae = case when v_src ? 'nome_mae' then v_r.nome_mae else c.nome_mae end,
        nacionalidade = case when v_src ? 'nacionalidade' then v_r.nacionalidade else c.nacionalidade end,
        naturalidade = case when v_src ? 'naturalidade' then v_r.naturalidade else c.naturalidade end,
        raca_cor = case when v_src ? 'raca_cor' then v_r.raca_cor else c.raca_cor end,
        grau_instrucao = case when v_src ? 'grau_instrucao' then v_r.grau_instrucao else c.grau_instrucao end,
        deficiencia = case when v_src ? 'deficiencia' then v_r.deficiencia else c.deficiencia end,
        folha_ponto_dispensa_justificativa = case when v_src ? 'folha_ponto_dispensa_justificativa' then v_r.folha_ponto_dispensa_justificativa else c.folha_ponto_dispensa_justificativa end,
        cargo_id = case when v_src ? 'cargo_id' then v_r.cargo_id else c.cargo_id end,
        forma_pagamento = case when v_src ? 'forma_pagamento' then v_r.forma_pagamento else c.forma_pagamento end,
        possui_folha_ponto = case when v_src ? 'possui_folha_ponto' then v_r.possui_folha_ponto else c.possui_folha_ponto end,
        optante_adiantamento = case when v_src ? 'optante_adiantamento' then v_r.optante_adiantamento else c.optante_adiantamento end,
        ficha_importacao_item_id = case when v_src ? 'ficha_importacao_item_id' then v_r.ficha_importacao_item_id else c.ficha_importacao_item_id end,
        regime = case when v_src ? 'regime' then v_r.regime else c.regime end,
        unidade_id = case when v_src ? 'unidade_id' then v_r.unidade_id else c.unidade_id end,
        setor_id = case when v_src ? 'setor_id' then v_r.setor_id else c.setor_id end,
        updated_at = now()
        where c.id = v_colab and c.company_id = v_company;
      else
        update public.dp_colaboradores c set
        nome = case when v_src ? 'nome' then v_r.nome else c.nome end,
        cpf = case when v_src ? 'cpf' then v_r.cpf else c.cpf end,
        matricula = case when v_src ? 'matricula' then v_r.matricula else c.matricula end,
        data_nascimento = case when v_src ? 'data_nascimento' then v_r.data_nascimento else c.data_nascimento end,
        data_admissao = case when v_src ? 'data_admissao' then v_r.data_admissao else c.data_admissao end,
        sexo = case when v_src ? 'sexo' then v_r.sexo else c.sexo end,
        telefone = case when v_src ? 'telefone' then v_r.telefone else c.telefone end,
        whatsapp = case when v_src ? 'whatsapp' then v_r.whatsapp else c.whatsapp end,
        email_contato = case when v_src ? 'email_contato' then v_r.email_contato else c.email_contato end,
        estado_civil = case when v_src ? 'estado_civil' then v_r.estado_civil else c.estado_civil end,
        endereco = case when v_src ? 'endereco' then v_r.endereco else c.endereco end,
        cargo = case when v_src ? 'cargo' then v_r.cargo else c.cargo end,
        salario_base = case when v_src ? 'salario_base' then v_r.salario_base else c.salario_base end,
        rg_numero = case when v_src ? 'rg_numero' then v_r.rg_numero else c.rg_numero end,
        rg_orgao = case when v_src ? 'rg_orgao' then v_r.rg_orgao else c.rg_orgao end,
        rg_uf = case when v_src ? 'rg_uf' then v_r.rg_uf else c.rg_uf end,
        rg_emissao = case when v_src ? 'rg_emissao' then v_r.rg_emissao else c.rg_emissao end,
        ctps_numero = case when v_src ? 'ctps_numero' then v_r.ctps_numero else c.ctps_numero end,
        ctps_serie = case when v_src ? 'ctps_serie' then v_r.ctps_serie else c.ctps_serie end,
        ctps_uf = case when v_src ? 'ctps_uf' then v_r.ctps_uf else c.ctps_uf end,
        ctps_expedicao = case when v_src ? 'ctps_expedicao' then v_r.ctps_expedicao else c.ctps_expedicao end,
        titulo_eleitor = case when v_src ? 'titulo_eleitor' then v_r.titulo_eleitor else c.titulo_eleitor end,
        titulo_zona = case when v_src ? 'titulo_zona' then v_r.titulo_zona else c.titulo_zona end,
        titulo_secao = case when v_src ? 'titulo_secao' then v_r.titulo_secao else c.titulo_secao end,
        reservista = case when v_src ? 'reservista' then v_r.reservista else c.reservista end,
        reservista_categoria = case when v_src ? 'reservista_categoria' then v_r.reservista_categoria else c.reservista_categoria end,
        nome_pai = case when v_src ? 'nome_pai' then v_r.nome_pai else c.nome_pai end,
        nome_mae = case when v_src ? 'nome_mae' then v_r.nome_mae else c.nome_mae end,
        nacionalidade = case when v_src ? 'nacionalidade' then v_r.nacionalidade else c.nacionalidade end,
        naturalidade = case when v_src ? 'naturalidade' then v_r.naturalidade else c.naturalidade end,
        raca_cor = case when v_src ? 'raca_cor' then v_r.raca_cor else c.raca_cor end,
        grau_instrucao = case when v_src ? 'grau_instrucao' then v_r.grau_instrucao else c.grau_instrucao end,
        deficiencia = case when v_src ? 'deficiencia' then v_r.deficiencia else c.deficiencia end,
        folha_ponto_dispensa_justificativa = case when v_src ? 'folha_ponto_dispensa_justificativa' then v_r.folha_ponto_dispensa_justificativa else c.folha_ponto_dispensa_justificativa end,
        cargo_id = case when v_src ? 'cargo_id' then v_r.cargo_id else c.cargo_id end,
        forma_pagamento = case when v_src ? 'forma_pagamento' then v_r.forma_pagamento else c.forma_pagamento end,
        possui_folha_ponto = case when v_src ? 'possui_folha_ponto' then v_r.possui_folha_ponto else c.possui_folha_ponto end,
        optante_adiantamento = case when v_src ? 'optante_adiantamento' then v_r.optante_adiantamento else c.optante_adiantamento end,
        ficha_importacao_item_id = case when v_src ? 'ficha_importacao_item_id' then v_r.ficha_importacao_item_id else c.ficha_importacao_item_id end,
        updated_at = now()
        where c.id = v_colab and c.company_id = v_company;
      end if;
    exception when unique_violation then
      raise exception 'Já existe um colaborador com este CPF nesta empresa.' using errcode = '23505';
    end;
    get diagnostics v_afetadas = row_count;
    if v_afetadas <> 1 then raise exception 'O cadastro existente não pôde ser atualizado.' using errcode = '42501'; end if;
    v_status := 'atualizado';
  else
    v_r := jsonb_populate_record(null::public.dp_colaboradores, v_src);
    begin
      insert into public.dp_colaboradores (company_id, origem_cadastro, nome, cpf, matricula, data_nascimento, data_admissao, sexo, telefone, whatsapp, email_contato, estado_civil, endereco, cargo, salario_base, rg_numero, rg_orgao, rg_uf, rg_emissao, ctps_numero, ctps_serie, ctps_uf, ctps_expedicao, titulo_eleitor, titulo_zona, titulo_secao, reservista, reservista_categoria, nome_pai, nome_mae, nacionalidade, naturalidade, raca_cor, grau_instrucao, deficiencia, folha_ponto_dispensa_justificativa, cargo_id, forma_pagamento, possui_folha_ponto, optante_adiantamento, ficha_importacao_item_id, regime, unidade_id, setor_id)
      values (
        v_company,
        'ficha_importacao',
        v_r.nome,
        v_r.cpf,
        v_r.matricula,
        v_r.data_nascimento,
        v_r.data_admissao,
        v_r.sexo,
        v_r.telefone,
        v_r.whatsapp,
        v_r.email_contato,
        v_r.estado_civil,
        v_r.endereco,
        v_r.cargo,
        v_r.salario_base,
        v_r.rg_numero,
        v_r.rg_orgao,
        v_r.rg_uf,
        v_r.rg_emissao,
        v_r.ctps_numero,
        v_r.ctps_serie,
        v_r.ctps_uf,
        v_r.ctps_expedicao,
        v_r.titulo_eleitor,
        v_r.titulo_zona,
        v_r.titulo_secao,
        v_r.reservista,
        v_r.reservista_categoria,
        v_r.nome_pai,
        v_r.nome_mae,
        v_r.nacionalidade,
        v_r.naturalidade,
        v_r.raca_cor,
        v_r.grau_instrucao,
        v_r.deficiencia,
        v_r.folha_ponto_dispensa_justificativa,
        v_r.cargo_id,
        coalesce(v_r.forma_pagamento, 'mensalista'::public.dp_forma_pagamento),
        coalesce(v_r.possui_folha_ponto, false),
        coalesce(v_r.optante_adiantamento, false),
        v_r.ficha_importacao_item_id,
        coalesce(v_r.regime, 'clt'::public.dp_regime_trabalho),
        v_r.unidade_id,
        v_r.setor_id)
      returning id into v_colab;
    exception when unique_violation then
      raise exception 'Já existe um colaborador com este CPF nesta empresa.' using errcode = '23505';
    end;
    v_status := 'criado';
  end if;

  if p_jornada is not null then
    for v_dia in select * from jsonb_array_elements(p_jornada -> 'dias') loop
      if jsonb_typeof(v_dia) <> 'object' then raise exception 'Dia da jornada em formato inválido.' using errcode = '22023'; end if;
      if jsonb_typeof(v_dia -> 'dow') not in ('number','string') then raise exception 'Dia da semana inválido na jornada da ficha.' using errcode = '22023'; end if;
      begin v_dow := (v_dia ->> 'dow')::int; exception when others then raise exception 'Dia da semana inválido na jornada da ficha.' using errcode = '22023'; end;
      if v_dow is null or v_dow < 0 or v_dow > 6 then raise exception 'Dia da semana inválido na jornada da ficha.' using errcode = '22023'; end if;
      if v_dow = any(v_dows) then raise exception 'Dia da semana repetido na jornada da ficha.' using errcode = '22023'; end if;
      v_dows := v_dows || v_dow;
      if (v_dia ? 'trabalha') and jsonb_typeof(v_dia -> 'trabalha') not in ('boolean','null') then raise exception 'Indicação de trabalho inválida na jornada da ficha.' using errcode = '22023'; end if;
      v_trab := coalesce((v_dia ->> 'trabalha')::boolean, true);
      v_entrada := nullif(btrim(coalesce(v_dia ->> 'entrada', '')), '');
      v_saida := nullif(btrim(coalesce(v_dia ->> 'saida', '')), '');
      if (v_entrada is null) <> (v_saida is null) then raise exception 'Informe entrada e saída do dia na jornada da ficha.' using errcode = '22023'; end if;
      if v_entrada is not null then begin perform v_entrada::time, v_saida::time; exception when others then raise exception 'Horário inválido na jornada da ficha.' using errcode = '22023'; end; end if;
      if (v_dia ? 'intervalo_minutos') and jsonb_typeof(v_dia -> 'intervalo_minutos') not in ('number','null') then raise exception 'Intervalo inválido na jornada da ficha.' using errcode = '22023'; end if;
      v_intervalo := nullif(v_dia ->> 'intervalo_minutos', '')::int;
      if v_intervalo is not null and (v_intervalo < 0 or v_intervalo > 480) then raise exception 'Intervalo inválido na jornada da ficha.' using errcode = '22023'; end if;
      if not v_trab then v_folga_variavel := false; v_folga_fixa := coalesce(v_folga_fixa, v_dow::smallint); end if;
    end loop;

    select count(*) into v_configs from public.dp_colaborador_config_trabalho
      where colaborador_id = v_colab and company_id = v_company and vigencia_fim is null;
    if v_configs > 1 then raise exception 'Há mais de uma configuração de trabalho vigente para este colaborador.' using errcode = '22023'; end if;
    select id into v_config from public.dp_colaborador_config_trabalho
      where colaborador_id = v_colab and company_id = v_company and vigencia_fim is null for update;

    if v_config is null then
      insert into public.dp_colaborador_config_trabalho
        (company_id, colaborador_id, unidade_id, turno_padrao_id, folga_variavel, folga_fixa_dow, observacoes, vigencia_inicio)
      values (v_company, v_colab, p_unidade_id, p_turno_id, v_folga_variavel, v_folga_fixa,
        'Importado da ficha de registro', coalesce((v_src ->> 'data_admissao')::date, current_date))
      returning id into v_config;
    else
      update public.dp_colaborador_config_trabalho set
        unidade_id = coalesce(p_unidade_id, unidade_id), turno_padrao_id = coalesce(p_turno_id, turno_padrao_id),
        folga_variavel = v_folga_variavel, folga_fixa_dow = v_folga_fixa,
        observacoes = 'Importado da ficha de registro', updated_at = now()
      where id = v_config and company_id = v_company;
      get diagnostics v_afetadas = row_count;
      if v_afetadas <> 1 then raise exception 'A configuração de trabalho não pôde ser atualizada.' using errcode = '42501'; end if;
      delete from public.dp_colaborador_config_dias where config_id = v_config and company_id = v_company and not (dow = any(v_dows::smallint[]));
    end if;

    insert into public.dp_colaborador_config_dias as d
      (company_id, config_id, dow, trabalha, turno_id, entrada, saida, intervalo_minutos)
    select v_company, v_config, (x ->> 'dow')::smallint, coalesce((x ->> 'trabalha')::boolean, true),
      case when coalesce((x ->> 'trabalha')::boolean, true) then p_turno_id end,
      case when coalesce((x ->> 'trabalha')::boolean, true) then nullif(btrim(coalesce(x ->> 'entrada','')), '')::time end,
      case when coalesce((x ->> 'trabalha')::boolean, true) then nullif(btrim(coalesce(x ->> 'saida','')), '')::time end,
      case when coalesce((x ->> 'trabalha')::boolean, true) and nullif(btrim(coalesce(x ->> 'entrada','')), '') is not null then coalesce(nullif(x ->> 'intervalo_minutos','')::int, 0) end
    from jsonb_array_elements(p_jornada -> 'dias') x
    on conflict (config_id, dow) do update set
      company_id = excluded.company_id, trabalha = excluded.trabalha,
      turno_id = coalesce(excluded.turno_id, d.turno_id),
      entrada = case when excluded.trabalha then coalesce(excluded.entrada, d.entrada) end,
      saida = case when excluded.trabalha then coalesce(excluded.saida, d.saida) end,
      intervalo_minutos = case when not excluded.trabalha then null when excluded.entrada is not null then excluded.intervalo_minutos when d.entrada is not null then d.intervalo_minutos else null end,
      updated_at = now();
  end if;

  update public.dp_ficha_importacao_itens set
    status = v_status, colaborador_id = v_colab,
    dados_extraidos = case when p_dados_extraidos is not null and jsonb_typeof(p_dados_extraidos) = 'object' and p_dados_extraidos <> '{}'::jsonb then p_dados_extraidos else dados_extraidos end,
    erro_mensagem = null, updated_at = now()
  where id = v_item.id and company_id = v_company;
  get diagnostics v_afetadas = row_count;
  if v_afetadas <> 1 then raise exception 'A ficha não pôde ser marcada como aplicada.' using errcode = '42501'; end if;

  select count(*) filter (where status = 'criado'), count(*) filter (where status = 'atualizado'),
         count(*) filter (where status not in ('criado','atualizado','ignorado')), count(*),
         count(*) filter (where status in ('criado','atualizado','ignorado'))
    into v_criados, v_atualizados, v_pendentes, v_total, v_prontos
    from public.dp_ficha_importacao_itens where importacao_id = v_item.importacao_id;

  update public.dp_ficha_importacoes set criados = v_criados, atualizados = v_atualizados,
    status = case when status = 'ready' and v_total > 0 and v_prontos = v_total then 'concluida' else status end,
    concluido_em = case when status = 'ready' and v_total > 0 and v_prontos = v_total then coalesce(concluido_em, now()) else concluido_em end,
    updated_at = now()
  where id = v_item.importacao_id;

  return jsonb_build_object('colaborador_id', v_colab, 'status', v_status, 'ja_aplicado', false,
    'criados', v_criados, 'atualizados', v_atualizados, 'pendentes', v_pendentes,
    'arquivo_path', v_item.arquivo_path, 'pagina_inicio', v_item.pagina_inicio, 'pagina_fim', v_item.pagina_fim);
end
$function$;

REVOKE ALL ON FUNCTION public.dp_ficha_aplicar(uuid, jsonb, jsonb, text[], boolean, uuid, uuid, uuid, uuid, text, text, boolean, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dp_ficha_aplicar(uuid, jsonb, jsonb, text[], boolean, uuid, uuid, uuid, uuid, text, text, boolean, boolean, jsonb) TO authenticated, service_role;