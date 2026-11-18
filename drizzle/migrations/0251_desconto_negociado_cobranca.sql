CREATE TABLE public.billing_v2_descontos_negociados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_account_id uuid NOT NULL REFERENCES public.billing_accounts(id),
  module text NOT NULL CHECK (module IN ('pessoas', 'financeiro')),
  percentual numeric(5,2) NOT NULL CHECK (percentual > 0 AND percentual <= 50),
  mensalidades integer NOT NULL CHECK (mensalidades BETWEEN 1 AND 12),
  motivo text NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 5 AND 500),
  subscription_id uuid REFERENCES public.subscriptions(id),
  aplicado_em timestamptz,
  primeiro_vencimento date,
  ultimo_vencimento_com_desconto date,
  competencia_inicial date,
  competencia_final date,
  encerrado_em timestamptz,
  revogado_em timestamptz,
  revogado_por uuid,
  revogado_motivo text CHECK (revogado_motivo IS NULL OR char_length(revogado_motivo) <= 500),
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_v2_descontos_negociados_aplicacao CHECK (
    (subscription_id IS NULL AND aplicado_em IS NULL AND primeiro_vencimento IS NULL AND ultimo_vencimento_com_desconto IS NULL
      AND competencia_inicial IS NULL AND competencia_final IS NULL)
    OR (subscription_id IS NOT NULL AND aplicado_em IS NOT NULL AND primeiro_vencimento IS NOT NULL
      AND ultimo_vencimento_com_desconto IS NOT NULL AND competencia_inicial IS NOT NULL AND competencia_final IS NOT NULL))
);
COMMENT ON TABLE public.billing_v2_descontos_negociados IS
  'Desconto comercial negociado: aplicado na contratação; vale para as N primeiras mensalidades (base) e para os excedentes das competências da janela.';
CREATE UNIQUE INDEX billing_v2_descontos_negociados_um_aberto
  ON public.billing_v2_descontos_negociados (billing_account_id, module)
  WHERE revogado_em IS NULL AND encerrado_em IS NULL;
CREATE INDEX billing_v2_descontos_negociados_sub
  ON public.billing_v2_descontos_negociados (subscription_id) WHERE subscription_id IS NOT NULL;

GRANT SELECT ON public.billing_v2_descontos_negociados TO authenticated;
GRANT ALL ON public.billing_v2_descontos_negociados TO service_role;
ALTER TABLE public.billing_v2_descontos_negociados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin lê descontos negociados" ON public.billing_v2_descontos_negociados
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public._billing_v2_desconto_para_cotacao(_billing_account_id uuid, _module text)
RETURNS public.billing_v2_descontos_negociados
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.* FROM public.billing_v2_descontos_negociados d
   WHERE d.billing_account_id = _billing_account_id AND d.module = _module
     AND d.revogado_em IS NULL AND d.encerrado_em IS NULL
     AND (d.subscription_id IS NULL
       OR (now() AT TIME ZONE 'America/Sao_Paulo')::date <= d.ultimo_vencimento_com_desconto)
   ORDER BY d.created_at DESC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public._billing_v2_desconto_para_cotacao(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._billing_v2_desconto_para_cotacao(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.billing_v2_quote(_billing_account_id uuid, _itens jsonb, _billing_cycle text, _coupon_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m jsonb; a jsonb; p record; lim record; ad record; cp record;
  itens jsonb := '[]'::jsonb; erros jsonb := '[]'::jsonb; sugestoes jsonb := '[]'::jsonb;
  anual boolean := (_billing_cycle = 'yearly');
  meses int := CASE WHEN _billing_cycle = 'yearly' THEN 12 ELSE 1 END;
  plano_cents int; add_cents int; total int := 0; desconto_cupom int := 0; total_mensal_mod int;
  emp int; extra int; up record;
  por_colab boolean; colab_extra int; colab_total int; bloqueio text;
  dn record; dm record; descontos jsonb := '[]'::jsonb; base_mod int; desc_cents int; tem_desc boolean := false; pct_txt text;
BEGIN
  IF _billing_cycle NOT IN ('monthly','yearly') THEN
    RETURN jsonb_build_object('ok', false, 'erros', jsonb_build_array('Ciclo inválido'));
  END IF;
  IF jsonb_typeof(_itens->'modulos') <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'erros', jsonb_build_array('Nenhum módulo informado'));
  END IF;

  FOR m IN SELECT * FROM jsonb_array_elements(_itens->'modulos') LOOP
    SELECT * INTO p FROM plans WHERE slug = m->>'plano' AND is_active;
    IF NOT FOUND OR p.is_enterprise THEN
      erros := erros || to_jsonb(format('Plano %s indisponível para contratação direta', m->>'plano'));
      CONTINUE;
    END IF;
    -- plano por colaborador ativo (Enterprise): contratação direta só com o mínimo de colaboradores ativos
    bloqueio := public._billing_v2_enterprise_bloqueio(_billing_account_id, NULL, p.id);
    IF bloqueio IS NOT NULL THEN
      erros := erros || to_jsonb(bloqueio);
      CONTINUE;
    END IF;
    plano_cents := CASE WHEN anual THEN p.price_annual_cents ELSE p.price_monthly_cents END;
    itens := itens || jsonb_build_object('tipo','plano','modulo',p.module,'codigo',p.slug,'descricao',p.name,
      'quantidade',1,'unitario_cents',plano_cents,'desconto_cents',
      CASE WHEN anual THEN p.price_monthly_cents*12 - p.price_annual_cents ELSE 0 END,'total_cents',plano_cents);
    total := total + plano_cents;
    total_mensal_mod := p.price_monthly_cents;
    -- plano por colaborador ativo (Enterprise): base inclui a franquia mínima; o que passar é apurado no mês
    por_colab := coalesce(p.features ? 'price_per_collaborator_cents', false);
    colab_extra := 0;

    -- empresas cobertas
    emp := greatest(coalesce((m->>'empresas')::int, 1), 1);
    SELECT * INTO lim FROM plan_limits WHERE plan_id = p.id AND recurso = 'empresas';
    IF NOT FOUND AND por_colab THEN
      extra := 0; -- plano por colaborador: empresas sem limite
    ELSE
      extra := greatest(emp - coalesce(lim.incluido, 1), 0);
    END IF;
    IF extra > 0 AND NOT coalesce(lim.permite_adicional, false) THEN
      erros := erros || to_jsonb(format('%s não permite empresa adicional', p.name));
    ELSIF extra > 0 AND lim.max_adicional IS NOT NULL AND extra > lim.max_adicional THEN
      erros := erros || to_jsonb(format('%s permite no máximo %s empresa(s) adicional(is)', p.name, lim.max_adicional));
    END IF;
    IF extra > 0 THEN
      m := jsonb_set(m, '{adicionais}', coalesce(m->'adicionais','[]'::jsonb) || jsonb_build_array(jsonb_build_object('code','empresas','qtd',extra)));
    END IF;

    FOR a IN SELECT * FROM jsonb_array_elements(coalesce(m->'adicionais','[]'::jsonb)) LOOP
      SELECT * INTO ad FROM plan_addons WHERE module = p.module AND code = a->>'code' AND is_active;
      IF NOT FOUND THEN erros := erros || to_jsonb(format('Adicional %s inexistente', a->>'code')); CONTINUE; END IF;
      IF ad.allowed_plan_slugs IS NOT NULL AND NOT (p.slug = ANY(ad.allowed_plan_slugs)) THEN
        erros := erros || to_jsonb(format('%s não disponível no %s', ad.name, p.name)); CONTINUE;
      END IF;
      IF coalesce((a->>'qtd')::int,0) <= 0 THEN CONTINUE; END IF;
      IF ad.code = 'colaboradores' THEN
        colab_extra := colab_extra + (a->>'qtd')::int;
        -- plano por colaborador não vende adicional de colaborador: o excedente é apurado no mês
        IF por_colab THEN CONTINUE; END IF;
      END IF;
      IF ad.recurso = 'unidades' THEN
        SELECT * INTO lim FROM plan_limits WHERE plan_id = p.id AND recurso = 'unidades';
        IF FOUND AND NOT lim.permite_adicional THEN
          erros := erros || to_jsonb(format('%s não permite unidade adicional', p.name)); CONTINUE;
        END IF;
      END IF;
      -- adicional anual: 12 meses com o mesmo desconto proporcional do plano
      add_cents := CASE WHEN anual THEN round(ad.price_cents * 12 * (1 - coalesce(p.annual_discount_pct,0)/100.0))::int ELSE ad.price_cents END;
      itens := itens || jsonb_build_object('tipo','adicional','modulo',p.module,'codigo',ad.code,'descricao',ad.name,
        'quantidade',(a->>'qtd')::int,'unitario_cents',add_cents,
        'desconto_cents', CASE WHEN anual THEN (ad.price_cents*12 - add_cents)*(a->>'qtd')::int ELSE 0 END,
        'total_cents',add_cents*(a->>'qtd')::int);
      total := total + add_cents*(a->>'qtd')::int;
      total_mensal_mod := total_mensal_mod + ad.price_cents*(a->>'qtd')::int;
    END LOOP;

    -- sugestão de upgrade: plano superior do mesmo módulo mais barato que plano + adicionais
    SELECT coalesce(max(incluido),0) + colab_extra INTO colab_total FROM plan_limits WHERE plan_id = p.id AND recurso = 'colaboradores';
    FOR up IN SELECT x.slug, x.name, x.price_monthly_cents FROM (
        SELECT pp.slug, pp.name, pp.price_monthly_cents
             + CASE WHEN pp.features ? 'price_per_collaborator_cents'
                    THEN greatest(colab_total - coalesce(plc.incluido, 0), 0) * (pp.features->>'price_per_collaborator_cents')::int
                    ELSE 0 END AS price_monthly_cents
          FROM plans pp LEFT JOIN plan_limits plc ON plc.plan_id = pp.id AND plc.recurso = 'colaboradores'
         WHERE pp.module = p.module AND pp.is_active AND NOT pp.is_enterprise AND pp.sort_order > p.sort_order) x
      WHERE x.price_monthly_cents < total_mensal_mod ORDER BY x.price_monthly_cents LIMIT 1 LOOP
      sugestoes := sugestoes || jsonb_build_object('de',p.slug,'para',up.slug,'nome',up.name,
        'mensal_atual_cents',total_mensal_mod,'mensal_sugerido_cents',up.price_monthly_cents,
        'mensagem',format('O %s sai mais barato (R$ %s/mês) que o plano atual com adicionais (R$ %s/mês).',
          up.name, to_char(up.price_monthly_cents/100.0,'FM999G990D00'), to_char(total_mensal_mod/100.0,'FM999G990D00')));
    END LOOP;
  END LOOP;

  -- desconto comercial negociado (por conta e módulo): só no mensal, sobre plano + adicionais do módulo
  FOR dm IN SELECT DISTINCT i->>'modulo' AS modulo FROM jsonb_array_elements(itens) i WHERE i->>'tipo' = 'plano' LOOP
    SELECT * INTO dn FROM public._billing_v2_desconto_para_cotacao(_billing_account_id, dm.modulo);
    IF NOT FOUND OR dn.id IS NULL THEN CONTINUE; END IF;
    pct_txt := replace(trim_scale(dn.percentual)::text, '.', ',');
    IF anual THEN
      descontos := descontos || jsonb_build_object('id', dn.id, 'modulo', dm.modulo, 'percentual', dn.percentual,
        'mensalidades', dn.mensalidades, 'aplica', false, 'motivo_nao_aplica', 'ciclo_anual',
        'aplicado', dn.subscription_id IS NOT NULL, 'ultimo_vencimento', dn.ultimo_vencimento_com_desconto,
        'competencia_inicial', dn.competencia_inicial, 'competencia_final', dn.competencia_final);
      CONTINUE;
    END IF;
    SELECT coalesce(sum((i->>'total_cents')::int), 0) INTO base_mod FROM jsonb_array_elements(itens) i
     WHERE i->>'modulo' = dm.modulo AND i->>'tipo' IN ('plano', 'adicional');
    desc_cents := round(base_mod * dn.percentual / 100.0)::int;
    IF desc_cents <= 0 THEN CONTINUE; END IF;
    tem_desc := true;
    itens := itens || jsonb_build_object('tipo', 'desconto_comercial', 'modulo', dm.modulo, 'codigo', 'desconto_comercial',
      'descricao', CASE WHEN dn.subscription_id IS NOT NULL
          THEN format('Desconto negociado de %s%% (até o vencimento de %s)', pct_txt, to_char(dn.ultimo_vencimento_com_desconto, 'DD/MM/YYYY'))
          WHEN dn.mensalidades = 1 THEN format('Desconto negociado de %s%% (primeira mensalidade)', pct_txt)
          ELSE format('Desconto negociado de %s%% (%s primeiras mensalidades)', pct_txt, dn.mensalidades) END,
      'quantidade', 1, 'percentual', dn.percentual, 'unitario_cents', -desc_cents, 'desconto_cents', desc_cents, 'total_cents', -desc_cents);
    total := total - desc_cents;
    descontos := descontos || jsonb_build_object('id', dn.id, 'modulo', dm.modulo, 'percentual', dn.percentual,
      'mensalidades', dn.mensalidades, 'aplica', true, 'desconto_cents', desc_cents,
      'aplicado', dn.subscription_id IS NOT NULL, 'ultimo_vencimento', dn.ultimo_vencimento_com_desconto,
      'competencia_inicial', dn.competencia_inicial, 'competencia_final', dn.competencia_final);
  END LOOP;

  -- cupom: só no mensal e só sobre o valor dos planos
  IF nullif(trim(_coupon_code),'') IS NOT NULL THEN
    IF anual THEN
      erros := erros || to_jsonb('Cupom não acumula com o desconto do plano anual'::text);
    ELSIF tem_desc THEN
      erros := erros || to_jsonb('Cupom não acumula com o desconto negociado'::text);
    ELSE
      SELECT * INTO cp FROM coupons WHERE upper(code) = upper(trim(_coupon_code)) AND is_active
        AND (valid_from IS NULL OR valid_from <= now()) AND (valid_until IS NULL OR valid_until >= now())
        AND (max_redemptions IS NULL OR times_redeemed < max_redemptions);
      IF NOT FOUND THEN
        erros := erros || to_jsonb('Cupom inválido ou expirado'::text);
      ELSE
        SELECT coalesce(sum((i->>'total_cents')::int),0) INTO plano_cents FROM jsonb_array_elements(itens) i WHERE i->>'tipo'='plano';
        desconto_cupom := least(plano_cents, CASE WHEN cp.discount_type::text = 'percent'
          THEN round(plano_cents * cp.discount_value/100.0)::int ELSE round(cp.discount_value*100)::int END);
        itens := itens || jsonb_build_object('tipo','cupom','codigo',cp.code,'descricao','Cupom '||cp.code,
          'quantidade',1,'unitario_cents',-desconto_cupom,'desconto_cents',desconto_cupom,'total_cents',-desconto_cupom);
        total := total - desconto_cupom;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', jsonb_array_length(erros) = 0, 'ciclo', _billing_cycle, 'meses', meses,
    'itens', itens, 'erros', erros, 'sugestoes_upgrade', sugestoes, 'descontos_comerciais', descontos,
    'total_ciclo_cents', greatest(total,0), 'total_agora_cents', greatest(total,0),
    'billing_account_id', _billing_account_id);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_desconto_negociado_registrar(
  _billing_account_id uuid, _module text, _percentual numeric, _mensalidades integer, _motivo text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Somente a equipe Aveto pode registrar desconto negociado.' USING ERRCODE = '42501';
  END IF;
  IF _module NOT IN ('pessoas', 'financeiro') THEN RAISE EXCEPTION 'Módulo inválido.'; END IF;
  IF _percentual IS NULL OR _percentual <= 0 OR _percentual > 50 THEN RAISE EXCEPTION 'O desconto deve ficar entre 0,01%% e 50%%.'; END IF;
  IF _mensalidades IS NULL OR _mensalidades < 1 OR _mensalidades > 12 THEN RAISE EXCEPTION 'Informe de 1 a 12 mensalidades.'; END IF;
  IF char_length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Descreva o motivo da negociação.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_accounts WHERE id = _billing_account_id) THEN
    RAISE EXCEPTION 'Conta de cobrança não encontrada.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.subscriptions s
              WHERE s.billing_account_id = _billing_account_id AND s.module = _module
                AND s.status::text IN ('active', 'past_due', 'pending') AND s.external_subscription_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Esta conta já tem assinatura paga deste módulo; o desconto negociado vale só para a próxima contratação.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.billing_v2_descontos_negociados d
              WHERE d.billing_account_id = _billing_account_id AND d.module = _module
                AND d.revogado_em IS NULL AND d.encerrado_em IS NULL) THEN
    RAISE EXCEPTION 'Já existe um desconto negociado em aberto para este módulo. Revogue-o antes de registrar outro.';
  END IF;
  INSERT INTO public.billing_v2_descontos_negociados (billing_account_id, module, percentual, mensalidades, motivo, criado_por)
  VALUES (_billing_account_id, _module, round(_percentual, 2), _mensalidades, btrim(_motivo), auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO public.billing_account_events (billing_account_id, tipo_evento, actor_id, payload)
  VALUES (_billing_account_id, 'desconto_negociado_registrado', auth.uid(),
    jsonb_build_object('desconto_id', v_id, 'modulo', _module, 'percentual', round(_percentual, 2), 'mensalidades', _mensalidades, 'motivo', btrim(_motivo)));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_desconto_negociado_registrar(uuid, text, numeric, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_desconto_negociado_registrar(uuid, text, numeric, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_desconto_negociado_revogar(_id uuid, _motivo text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.billing_v2_descontos_negociados;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Somente a equipe Aveto pode revogar desconto negociado.' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(coalesce(_motivo, ''))) < 5 THEN RAISE EXCEPTION 'Descreva o motivo da revogação.'; END IF;
  UPDATE public.billing_v2_descontos_negociados
     SET revogado_em = now(), revogado_por = auth.uid(), revogado_motivo = left(btrim(_motivo), 500)
   WHERE id = _id AND revogado_em IS NULL AND encerrado_em IS NULL
  RETURNING * INTO d;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Desconto não encontrado ou já encerrado.'; END IF;
  INSERT INTO public.billing_account_events (billing_account_id, tipo_evento, actor_id, payload)
  VALUES (d.billing_account_id, 'desconto_negociado_revogado', auth.uid(),
    jsonb_build_object('desconto_id', d.id, 'subscription_id', d.subscription_id, 'motivo', btrim(_motivo)));
END $$;
REVOKE ALL ON FUNCTION public.admin_desconto_negociado_revogar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_desconto_negociado_revogar(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_descontos_negociados_lista(_billing_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso restrito à equipe Aveto.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC)
    FROM public.billing_v2_descontos_negociados d WHERE d.billing_account_id = _billing_account_id), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.admin_descontos_negociados_lista(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_descontos_negociados_lista(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.billing_v2_meus_descontos_negociados(_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_conta uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (public._is_company_member(_company_id, auth.uid()) OR public.is_super_admin(auth.uid())) THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT billing_account_id INTO v_conta FROM public.billing_account_companies
   WHERE company_id = _company_id AND removed_at IS NULL LIMIT 1;
  IF v_conta IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'modulo', d.module, 'percentual', d.percentual, 'mensalidades', d.mensalidades,
      'aplicado', d.subscription_id IS NOT NULL, 'subscription_id', d.subscription_id,
      'primeiro_vencimento', d.primeiro_vencimento, 'ultimo_vencimento', d.ultimo_vencimento_com_desconto,
      'competencia_inicial', d.competencia_inicial, 'competencia_final', d.competencia_final,
      'encerrado', d.encerrado_em IS NOT NULL
        OR (d.subscription_id IS NOT NULL AND (now() AT TIME ZONE 'America/Sao_Paulo')::date > d.ultimo_vencimento_com_desconto
            AND date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date > d.competencia_final))
      ORDER BY d.created_at DESC)
    FROM public.billing_v2_descontos_negociados d
   WHERE d.billing_account_id = v_conta AND d.revogado_em IS NULL), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.billing_v2_meus_descontos_negociados(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_v2_meus_descontos_negociados(uuid) TO authenticated, service_role;