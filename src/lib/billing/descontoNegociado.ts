// Apresentação do desconto negociado (os valores vêm sempre do servidor).
export type DescontoNegociadoInfo = {
  id: string;
  modulo: string;
  percentual: number;
  mensalidades: number;
  aplicado?: boolean;
  aplica?: boolean;
  motivo_nao_aplica?: string | null;
  ultimo_vencimento?: string | null;
  competencia_inicial?: string | null;
  competencia_final?: string | null;
  encerrado?: boolean;
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const pctTexto = (p: number) => `${String(Number(p)).replace(".", ",")}%`;
export const competenciaTexto = (c?: string | null) => (c ? `${MESES[Number(c.slice(5, 7)) - 1]}/${c.slice(0, 4)}` : "—");
export const dataTexto = (d?: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
const primeiras = (n: number) => (n === 1 ? "na primeira mensalidade" : `nas ${n} primeiras mensalidades`);

/** Uma frase clara do que o desconto cobre, para o cliente. */
export function resumoDescontoNegociado(d: DescontoNegociadoInfo, comExcedente = false): string {
  const pct = pctTexto(d.percentual);
  if (d.motivo_nao_aplica === "ciclo_anual") return `O desconto negociado de ${pct} vale só no plano mensal.`;
  const excedente = comExcedente ? " Os colaboradores acima da franquia desses meses também saem com o desconto." : "";
  if (d.aplicado && d.ultimo_vencimento) {
    const fimExc = comExcedente && d.competencia_final ? ` (excedentes até ${competenciaTexto(d.competencia_final)})` : "";
    return d.encerrado
      ? `Desconto negociado de ${pct} encerrado. As mensalidades seguem pelo valor de tabela.`
      : `Desconto negociado de ${pct} até a mensalidade com vencimento em ${dataTexto(d.ultimo_vencimento)}${fimExc}. Depois, valor de tabela.`;
  }
  return `Desconto negociado de ${pct} ${primeiras(d.mensalidades)}.${excedente} Depois, o valor volta ao de tabela.`;
}
