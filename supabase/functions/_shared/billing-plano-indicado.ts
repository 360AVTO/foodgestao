// Plano indicado nos lembretes do teste e da carência (Pessoas 360°).
// Regra de ouro: a mensagem só cita fatos verificáveis no banco — quantidade de
// colaboradores ativos e o plano que comporta essa equipe. Nunca presume escala,
// folgas, documentos ou qualquer outra etapa da implantação. O valor final é
// sempre o calculado pelo servidor na contratação; aqui é só uma estimativa.
import {
  enquadrarPlanoPessoas, minimoEnterprise, planoPorColaborador, type PlanoCatalogo,
} from "./billing-enquadramento.ts";

export const SITE_URL = "https://www.aveto360.com";

export type IndicacaoPlano =
  | { tipo: "sem_equipe"; colaboradores: 0; linkPlanos: string }
  | { tipo: "sob_consulta"; colaboradores: number; linkPlanos: string }
  | {
    tipo: "plano";
    colaboradores: number;
    slug: string;
    plano: string;
    detalhePlano: string;
    linkPlanos: string;
  };

export type PlanoComPreco = PlanoCatalogo & { price_monthly_cents?: number | null };

export const reais = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");

function numero(features: PlanoCatalogo["features"], chave: string): number | null {
  const v = Number((features ?? {})[chave]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Desconto negociado ainda a contratar (percentual sobre a mensalidade nas N primeiras). */
export type DescontoIndicacao = { percentual: number; mensalidades: number };

const pctTexto = (p: number) => `${String(Number(p)).replace(".", ",")}%`;
const comPct = (c: number, p: number) => Math.round((c * (100 - p)) / 100);
const primeiras = (n: number) => (n === 1 ? "na primeira mensalidade" : `nas ${n} primeiras mensalidades`);

/** Texto curto do preço: fixo ("R$ 89,90/mês, até 8 colaboradores") ou por colaborador com estimativa. */
export function detalheDoPlano(p: PlanoComPreco, colaboradores: number, desconto?: DescontoIndicacao | null): string {
  const d = desconto && desconto.percentual > 0 && desconto.mensalidades > 0 ? desconto : null;
  if (planoPorColaborador(p)) {
    const unit = numero(p.features, "price_per_collaborator_cents") ?? 0;
    const qtd = Math.max(colaboradores, minimoEnterprise(p));
    const base = `${reais(unit)} por colaborador ativo, hoje cerca de ${reais(qtd * unit)}/mês`;
    if (!d) return base;
    const unitD = comPct(unit, d.percentual);
    return `${base}; com o desconto negociado de ${pctTexto(d.percentual)}, ${reais(unitD)} por colaborador (cerca de ${reais(qtd * unitD)}/mês) ${primeiras(d.mensalidades)}`;
  }
  const mensal = Number(p.price_monthly_cents ?? 0);
  const partes = [`${reais(mensal)}/mês`];
  const maxColab = numero(p.features, "max_collaborators");
  if (maxColab) partes.push(`até ${maxColab} colaboradores`);
  if (d) partes.push(`com o desconto negociado de ${pctTexto(d.percentual)}, ${reais(comPct(mensal, d.percentual))}/mês ${primeiras(d.mensalidades)}`);
  return partes.join(", ");
}

/**
 * Indica o plano pelo tamanho real da equipe. Sem colaboradores ativos, a
 * mensagem fala de ajuda na implantação (sem preço); caso fora da contratação
 * direta vira "sob consulta"; senão, o mesmo plano que a tela de planos marca.
 */
export function indicarPlanoPessoas(
  planos: PlanoComPreco[],
  equipe: { colaboradores: number; unidades?: number | null },
  site = SITE_URL,
  desconto?: DescontoIndicacao | null,
): IndicacaoPlano | null {
  const colaboradores = Math.max(0, Math.floor(Number(equipe.colaboradores) || 0));
  const geral = `${site}/planos`;
  if (colaboradores === 0) return { tipo: "sem_equipe", colaboradores: 0, linkPlanos: geral };
  const e = enquadrarPlanoPessoas(planos, { colaboradores, unidades: equipe.unidades ?? 0 });
  if (!e) return null;
  if (e.tipo === "sob_consulta") return { tipo: "sob_consulta", colaboradores, linkPlanos: geral };
  const p = e.plano as PlanoComPreco;
  return {
    tipo: "plano",
    colaboradores,
    slug: p.slug,
    plano: p.name,
    detalhePlano: detalheDoPlano(p, colaboradores, desconto),
    linkPlanos: `${site}/planos?plano=${encodeURIComponent(p.slug)}`,
  };
}

/** Estágios do teste e da carência que levam o plano indicado. */
export const ESTAGIOS_COM_INDICACAO = new Set([
  "trial_d5", "trial_d7", "trial_pos_1", "trial_pos_4", "trial_pos_8",
  "cortesia_encerrada", "grace_d_menos_3", "grace_d_menos_1", "grace_d0",
]);

export type DadosIndicacao = {
  indicacao?: "plano" | "sem_equipe" | "sob_consulta";
  colaboradores?: number;
  plano?: string;
  detalhePlano?: string;
};

const colab = (n: number) => `${n} ${n === 1 ? "colaborador ativo" : "colaboradores ativos"}`;

/**
 * Parágrafo da indicação (mesmo conteúdo no WhatsApp e no e-mail).
 * `negrito` usa *texto* do WhatsApp; no e-mail vem sem marcação.
 */
export function trechoIndicacao(d: DadosIndicacao, negrito = false): string | null {
  const b = (t: string) => (negrito ? `*${t}*` : t);
  if (d.indicacao === "plano" && d.plano && typeof d.colaboradores === "number") {
    return `Hoje a empresa tem ${b(colab(d.colaboradores))} cadastrados. Para esse tamanho de equipe, o plano indicado é o ${b(d.plano)}${d.detalhePlano ? ` (${d.detalhePlano})` : ""}. O valor final é confirmado na contratação.`;
  }
  // No WhatsApp a equipe Aveto atende a resposta na própria conversa.
  const contato = negrito ? "é só responder esta mensagem" : "fale com nosso atendimento";
  if (d.indicacao === "sob_consulta" && typeof d.colaboradores === "number") {
    return `Hoje a empresa tem ${b(colab(d.colaboradores))} cadastrados. Para a estrutura da sua empresa, preparamos uma proposta sob medida: ${contato}.`;
  }
  if (d.indicacao === "sem_equipe") {
    return `Ainda não há colaboradores cadastrados. Se quiser ajuda para trazer a sua equipe para o sistema, ${contato}.`;
  }
  return null;
}
