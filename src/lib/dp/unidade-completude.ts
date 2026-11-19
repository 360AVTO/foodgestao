/**
 * O que ainda falta no cadastro de uma unidade. Nada aqui é obrigatório para
 * importar fichas: a tela só sinaliza "Cadastro incompleto" e, ao tocar,
 * mostra a lista abaixo — sem poluir a esteira.
 *
 * Feriados locais e ponto usam as mesmas regras do Painel Inteligente
 * (`faltaFeriadoLocal` e `conformidadePonto`), para os dois nunca divergirem.
 */
import { faltaFeriadoLocal, type FeriadoRegra } from "@/lib/dp/feriados";
import { conformidadePonto } from "@/lib/dp/ponto-conformidade";

export type UnidadeCompletude = {
  cnpj?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  telefone?: string | null;
  tem_adiantamento?: boolean | null;
  dia_adiantamento?: number | null;
  pagamento_salario_tipo?: string | null;
  pagamento_salario_dia?: number | null;
  possui_relogio_ponto?: boolean | null;
  relogio_ponto_dispensa_justificativa?: string | null;
};

/** Aba do cadastro da unidade onde a informação é completada. */
export type AbaPendenciaUnidade = "dados" | "feriados" | "funcionamento";

export type PendenciaUnidade = {
  chave: string;
  rotulo: string;
  detalhe?: string;
  aba: AbaPendenciaUnidade;
  /** Só informativo: aparece na lista, mas não acende "Cadastro incompleto". */
  opcional?: boolean;
};

type RegraFeriado = Pick<FeriadoRegra, "tipo" | "dia" | "mes" | "codigo_movel" | "ativo" | "categoria">;

export type OpcoesCompletude = {
  /** Regras de feriado da unidade. Ausente = ainda carregando (não sinaliza). */
  feriados?: RegraFeriado[];
  /** `feriados_locais_ciente_em`: gestor confirmou que não há feriados locais. */
  feriadosCienteEm?: string | null;
  /** Quantas pessoas a unidade terá (ex.: fichas do lote), para o Art. 74. */
  pessoasPrevistas?: number;
  /** Horário de funcionamento definido? Ausente = ainda carregando. */
  funcionamentoDefinido?: boolean;
};

const vazio = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

export function pendenciasUnidade(
  u: UnidadeCompletude | null | undefined,
  opts: OpcoesCompletude = {},
): PendenciaUnidade[] {
  if (!u) return [];
  const out: PendenciaUnidade[] = [];
  if (vazio(u.cnpj)) out.push({ chave: "cnpj", rotulo: "CNPJ", aba: "dados" });
  const partes: Array<[keyof UnidadeCompletude, string]> = [
    ["logradouro", "rua"], ["numero", "número"], ["bairro", "bairro"], ["cep", "CEP"], ["cidade", "cidade"], ["uf", "UF"],
  ];
  const faltaEndereco = partes.filter(([k]) => vazio(u[k])).map(([, r]) => r);
  if (faltaEndereco.length > 0) {
    out.push({
      chave: "endereco",
      rotulo: "Endereço",
      detalhe: faltaEndereco.length === partes.length ? "em branco" : `falta ${faltaEndereco.join(", ")}`,
      aba: "dados",
    });
  }
  if (vazio(u.telefone)) out.push({ chave: "telefone", rotulo: "Telefone", aba: "dados" });
  if (vazio(u.pagamento_salario_tipo) || (u.pagamento_salario_tipo === "dia_fixo" && vazio(u.pagamento_salario_dia))) {
    out.push({ chave: "pagamento", rotulo: "Dia do pagamento do salário", aba: "dados" });
  }
  if (u.tem_adiantamento && vazio(u.dia_adiantamento)) {
    out.push({ chave: "adiantamento", rotulo: "Dia do adiantamento", aba: "dados" });
  }
  if (
    opts.pessoasPrevistas !== undefined &&
    conformidadePonto(u, opts.pessoasPrevistas) === "irregular"
  ) {
    out.push({
      chave: "ponto",
      rotulo: "Registro de ponto (Art. 74 da CLT)",
      detalhe: `${opts.pessoasPrevistas} pessoas: ative o ponto ou registre a justificativa`,
      aba: "dados",
    });
  }
  if (opts.feriados !== undefined) {
    const ativos = opts.feriados.filter((f) => f.ativo !== false);
    if (ativos.length === 0) {
      out.push({ chave: "feriados", rotulo: "Feriados", detalhe: "nenhum feriado ativo", aba: "feriados" });
    } else if (faltaFeriadoLocal(opts.feriados, opts.feriadosCienteEm)) {
      const local = [u.cidade, u.uf].filter((v) => !vazio(v)).join(" - ");
      out.push({
        chave: "feriados_locais",
        rotulo: "Feriados municipais e estaduais",
        detalhe: `${local ? `${local}: ` : ""}cadastre os da cidade/estado ou confirme que não há`,
        aba: "feriados",
      });
    }
  }
  if (opts.funcionamentoDefinido === false) {
    out.push({
      chave: "funcionamento",
      rotulo: "Horário de funcionamento da loja",
      detalhe: "opcional",
      aba: "funcionamento",
      opcional: true,
    });
  }
  return out;
}

/** Aba que o botão "Completar cadastro" abre: a da primeira pendência que importa. */
export function abaParaCompletar(faltas: PendenciaUnidade[]): AbaPendenciaUnidade {
  return (faltas.find((f) => !f.opcional) ?? faltas[0])?.aba ?? "dados";
}
