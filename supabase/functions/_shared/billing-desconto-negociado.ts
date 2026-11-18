// Desconto comercial negociado (ex.: 10% nas 3 primeiras mensalidades).
// Regras puras — o valor da mensalidade sai sempre de billing_v2_quote; aqui só
// a janela do desconto, o preço do excedente e quando a mensalidade volta ao normal.

export type DescontoNegociado = {
  id: string;
  percentual: number;
  mensalidades: number;
  subscription_id?: string | null;
  ultimo_vencimento_com_desconto?: string | null;
  competencia_inicial?: string | null;
  competencia_final?: string | null;
  encerrado_em?: string | null;
  revogado_em?: string | null;
};

/** Valor com o desconto (centavos inteiros, arredondamento comercial). */
export function comDesconto(cents: number, percentual: number): number {
  const c = Math.max(0, Math.round(Number(cents) || 0));
  const p = Math.min(100, Math.max(0, Number(percentual) || 0));
  return Math.round((c * (100 - p)) / 100);
}

/** Soma meses a uma data AAAA-MM-DD (UTC), limitando ao último dia do mês. */
export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.slice(0, 10).split("-").map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/** Data de hoje no horário de Brasília (AAAA-MM-DD). */
export function hojeBrasilia(agora = new Date()): string {
  return new Date(agora.getTime() - 3 * 3600000).toISOString().slice(0, 10);
}

/**
 * Janela do desconto a partir da contratação: as N primeiras mensalidades
 * (até o vencimento da N-ésima) e os excedentes das N primeiras competências.
 */
export function janelaDesconto(dataContratacao: string, primeiroVencimento: string, mensalidades: number) {
  const n = Math.max(1, Math.floor(mensalidades));
  const competencia_inicial = `${dataContratacao.slice(0, 7)}-01`;
  return {
    competencia_inicial,
    competencia_final: somarMeses(competencia_inicial, n - 1),
    ultimo_vencimento_com_desconto: somarMeses(primeiroVencimento, n - 1),
  };
}

/** Percentual que vale para o excedente de uma competência (0 = preço de tabela). */
export function percentualExcedente(d: DescontoNegociado | null | undefined, competencia: string): number {
  if (!d || d.revogado_em || !d.subscription_id || !d.competencia_inicial || !d.competencia_final) return 0;
  const c = `${competencia.slice(0, 7)}-01`;
  return c >= d.competencia_inicial.slice(0, 10) && c <= d.competencia_final.slice(0, 10) ? Number(d.percentual) : 0;
}

/**
 * A mensalidade volta ao valor de tabela no Asaas quando o vencimento da última
 * mensalidade com desconto já passou (ela fica paga ou vencida com o valor antigo
 * e só a próxima, ainda pendente, é atualizada) ou quando o desconto foi revogado.
 */
export function mensalidadeDeveVoltar(d: DescontoNegociado, hoje: string): boolean {
  if (!d.subscription_id || d.encerrado_em) return false;
  if (d.revogado_em) return true;
  return !!d.ultimo_vencimento_com_desconto && hoje > d.ultimo_vencimento_com_desconto.slice(0, 10);
}
