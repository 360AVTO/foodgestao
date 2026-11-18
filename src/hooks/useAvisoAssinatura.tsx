import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyContext } from "@/hooks/useCompanyContext";
import { useCompanyEntitlements } from "@/hooks/useModuleAccess";
import {
  avisoDoModulo, chaveBalao, escolherAviso, type AvisoAssinatura,
} from "@/lib/billing/avisoAssinatura";
import {
  indicarPlanoPessoas, type IndicacaoPlano, type PlanoComPreco,
} from "../../supabase/functions/_shared/billing-plano-indicado.ts";

export interface ResumoAvisoAssinatura {
  empresa: string | null;
  colaboradores: number;
  unidades: number;
  meu_nome: string | null;
  pode_contratar: boolean;
  responsaveis: string[];
}

/** Resumo da empresa para o aviso (nome, equipe, quem pode contratar) — decidido no banco. */
export function useResumoAvisoAssinatura(companyId: string | null | undefined, ativo = true) {
  return useQuery({
    queryKey: ["aviso-assinatura-resumo", companyId],
    enabled: !!companyId && ativo,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ResumoAvisoAssinatura | null> => {
      const { data, error } = await supabase.rpc("billing_aviso_assinatura" as any, { _company_id: companyId });
      if (error) throw error;
      return (data as unknown as ResumoAvisoAssinatura) ?? null;
    },
  });
}

/** Plano indicado pelo tamanho da equipe (só Pessoas 360°); valor final é sempre do servidor. */
export function useIndicacaoPessoas(colaboradores: number | null | undefined, unidades: number | null | undefined, ativo = true) {
  const planos = useQuery({
    queryKey: ["planos-publicos"],
    enabled: ativo,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("plans").select("*")
        .eq("is_active", true).eq("is_public", true).order("module").order("sort_order");
      if (error) throw error;
      return data as any[];
    },
  });
  return useMemo<IndicacaoPlano | null>(() => {
    if (!ativo || colaboradores == null) return null;
    const catalogo = ((planos.data ?? []) as PlanoComPreco[]).filter((p: any) => p.module === "pessoas");
    if (!catalogo.length) return null;
    return indicarPlanoPessoas(catalogo, { colaboradores, unidades: unidades ?? 0 });
  }, [ativo, colaboradores, unidades, planos.data]);
}

const lerSessao = (k: string) => { try { return sessionStorage.getItem(k) === "1"; } catch { return false; } };
const gravarSessao = (k: string) => { try { sessionStorage.setItem(k, "1"); } catch { /* sem armazenamento */ } };

/** Balão de fim de teste/carência: uma vez por dia na sessão, por empresa, módulo e fase. */
export function useAvisoAssinatura() {
  const { selectedCompanyId } = useCompanyContext();
  const { data: ent } = useCompanyEntitlements();

  const aviso: AvisoAssinatura | null = useMemo(() => {
    if (!ent || ent.mode !== "v2") return null;
    return escolherAviso([avisoDoModulo("pessoas", ent.pessoas), avisoDoModulo("financeiro", ent.financeiro)]);
  }, [ent]);

  const chave = aviso && selectedCompanyId ? chaveBalao(selectedCompanyId, aviso) : null;
  const resumo = useResumoAvisoAssinatura(selectedCompanyId, !!aviso);
  const pessoas = aviso?.modulo === "pessoas";
  const indicacao = useIndicacaoPessoas(resumo.data?.colaboradores, resumo.data?.unidades, pessoas && !!resumo.data);

  const [fechado, setFechado] = useState<string | null>(null);
  const [reaberto, setReaberto] = useState(false);
  useEffect(() => { if (chave && lerSessao(chave)) setFechado(chave); }, [chave]);

  const fechar = useCallback(() => {
    if (!chave) return;
    gravarSessao(chave);
    setFechado(chave);
    setReaberto(false);
  }, [chave]);

  /** "Ver detalhes" da faixa do topo: reabre o balão no mesmo dia. */
  const abrir = useCallback(() => setReaberto(true), []);

  // Só abre com o resumo carregado: membro que não é da empresa recebe null e não vê o balão.
  const aberto = !!aviso && !!chave && !!resumo.data && (reaberto || (fechado !== chave && !lerSessao(chave)));

  return { aviso, resumo: resumo.data ?? null, indicacao, aberto, fechar, abrir };
}
