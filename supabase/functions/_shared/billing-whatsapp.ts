// Régua de cobrança e do teste pelo WhatsApp da Aveto 360 — regras puras.
// O e-mail segue como aviso oficial; o WhatsApp é o lembrete de conveniência,
// com tom cordial e sem exposição (art. 42 do CDC).
import { normalizeBRPhone } from "./zapi.ts";
import { trechoIndicacao, type DadosIndicacao } from "./billing-plano-indicado.ts";
import { prazoDoTeste } from "./billing-prazo-teste.ts";

export type WaDados = DadosIndicacao & {
  nome?: string | null;
  empresa?: string;
  valor?: string;
  data?: string;
  dataSuspensao?: string;
  dataRescisao?: string;
  dataExpiracao?: string;
  diasAtraso?: number;
  link?: string;
  linkExportacao?: string;
  linkPlanos?: string;
  modulo?: string;
  /** Dias que faltam para o fim do teste (avisos da reta final). */
  diasRestantes?: number;
};

/** Pós-teste: 3 tentativas, em dias corridos após o fim do teste. */
export const POS_TESTE_DIAS = { trial_pos_1: 1, trial_pos_4: 4, trial_pos_8: 8 } as const;

export const ATENDIMENTO = "https://wa.me/5562992365959";

/** Avisos que continuam válidos se o envio cair no próximo dia útil. */
const ADIAVEIS = new Set([
  "trial_pos_1", "trial_pos_4", "trial_pos_8", "reativacao", "oferta_plano", "cortesia_encerrada",
  "d_mais_1", "d_mais_5", "d_mais_20", "d_mais_60",
]);

const BRT_MS = 3 * 3600 * 1000; // Brasil sem horário de verão (UTC-3)
const MIN = 60 * 1000;

type Janela = [inicioMin: number, fimMin: number];
/** Seg a sex, fora do pico do almoço e do jantar do food service. */
const JANELAS_COMERCIAIS: Janela[] = [[9 * 60 + 30, 11 * 60], [15 * 60, 16 * 60 + 30]];
/** Confirmação de pagamento: todo dia, em horário civil. */
const JANELAS_CONFIRMACAO: Janela[] = [[8 * 60, 20 * 60]];

function janelasDo(stage: string, diaSemana: number): Janela[] {
  if (stage === "reativacao") return JANELAS_CONFIRMACAO;
  if (diaSemana === 0 || diaSemana === 6) return [];
  return JANELAS_COMERCIAIS;
}

/** Próximo instante permitido para mandar o WhatsApp deste estágio. */
export function proximoEnvioWhatsapp(stage: string, agora: Date): Date {
  const local = new Date(agora.getTime() - BRT_MS);
  const meiaNoite = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  for (let d = 0; d < 10; d++) {
    const diaUtc = meiaNoite + d * 24 * 3600 * 1000;
    const semana = new Date(diaUtc).getUTCDay();
    for (const [ini, fim] of janelasDo(stage, semana)) {
      const inicio = diaUtc + ini * MIN + BRT_MS;
      const termino = diaUtc + fim * MIN + BRT_MS;
      if (agora.getTime() < termino) return new Date(Math.max(agora.getTime(), inicio));
    }
  }
  return agora;
}

/** Até quando o aviso faz sentido: mesmo dia (Brasília) ou 3 dias para os adiáveis. */
export function validadeWhatsapp(stage: string, criadoEm: Date): Date {
  if (ADIAVEIS.has(stage)) return new Date(criadoEm.getTime() + 3 * 24 * 3600 * 1000);
  const local = new Date(criadoEm.getTime() - BRT_MS);
  const fimDoDia = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 23, 59, 59, 999);
  return new Date(fimDoDia + BRT_MS);
}

export type DestinoWa = {
  phone: string;
  nome: string | null;
  papel: "dono" | "proprietario" | "admin" | "financeiro";
};

/**
 * Titular do acesso primeiro; o proprietário do negócio só com a opção da empresa ligada;
 * depois os demais gestores (donos/administradores ativos) e o responsável financeiro.
 * Cada número recebe uma única vez; inválidos ficam de fora.
 */
export function destinosWhatsapp(
  dono: { telefone?: string | null; nome?: string | null },
  financeiro: { telefone?: string | null; nome?: string | null },
  gestores: Array<{ telefone?: string | null; nome?: string | null }> = [],
  proprietario: { telefone?: string | null; nome?: string | null; recebe?: boolean | null } | null = null,
): DestinoWa[] {
  const saida: DestinoWa[] = [];
  const vistos = new Set<string>();
  const add = (tel: string | null | undefined, nome: string | null, papel: DestinoWa["papel"]) => {
    const n = normalizeBRPhone(tel ?? null);
    if (!n || vistos.has(n)) return;
    vistos.add(n);
    saida.push({ phone: n, nome, papel });
  };
  add(dono.telefone, dono.nome ?? null, "dono");
  if (proprietario?.recebe === true) add(proprietario.telefone, proprietario.nome ?? null, "proprietario");
  for (const g of gestores) add(g.telefone, g.nome ?? null, "admin");
  add(financeiro.telefone, financeiro.nome ?? null, "financeiro");
  return saida;
}

const ola = (d: WaDados) => (d.nome ? `Olá, ${d.nome}!` : "Olá!");
const emp = (d: WaDados) => d.empresa || "sua empresa";
const val = (d: WaDados) => d.valor || "em aberto";
const mod = (d: WaDados) => (d.modulo ? ` do ${d.modulo}` : "");
/** Plano indicado pela equipe real (ou ajuda na implantação), já com a quebra de parágrafo. */
const ind = (d: WaDados) => {
  const t = trechoIndicacao(d, true);
  return t ? `\n\n${t}` : "";
};
const escolha = (d: WaDados, padrao: string) => (d.indicacao === "plano" ? "ative o plano indicado" : padrao);
/** As respostas neste WhatsApp são atendidas pela equipe Aveto. */
export const RESPONDER = "é só responder esta mensagem";
const rodape = `\n\nDúvidas? É só responder esta mensagem.`;
const APOIO = `Se quiser tirar dúvidas ou precisar do apoio da nossa equipe para seguir com a implantação na sua operação, ${RESPONDER}.`;

/** Reta final, 3 dias antes: equipe real + plano indicado + link direto + resposta aqui. */
function avisoRetaFinal(d: WaDados, planos: string): string {
  const abertura = `${ola(d)} O teste gratuito da *${emp(d)}* no AVETO 360 encerra ${prazoDoTeste(d.diasRestantes ?? 3, d.data)}.${ind(d)}`;
  if (d.indicacao === "sob_consulta") return `${abertura}${planos ? `\n\nSe preferir, veja os planos:${planos}` : ""}`;
  const ativar = d.indicacao === "plano"
    ? "Você pode ativar o plano indicado direto por Pix ou cartão:"
    : "Você pode escolher seu plano e ativar direto por Pix ou cartão:";
  return `${abertura}\n\n${ativar}${planos}${d.indicacao === "sem_equipe" ? "" : `\n\n${APOIO}`}`;
}

/** Último dia (ou véspera, quando o fim cai no fim de semana): link direto para manter o acesso. */
function ultimoDiaTeste(d: WaDados, planos: string): string {
  const prazo = prazoDoTeste(d.diasRestantes ?? 0, d.data);
  const abertura = prazo === "hoje"
    ? `${ola(d)} Hoje é o último dia do teste gratuito da *${emp(d)}* no AVETO 360 (até 23h59).`
    : `${ola(d)} O teste gratuito da *${emp(d)}* no AVETO 360 encerra ${prazo}.`;
  if (d.indicacao === "sob_consulta") {
    return `${abertura}\n\nPara a estrutura da sua empresa, preparamos uma proposta sob medida: ${RESPONDER}.${planos ? `\n\nSe preferir, veja os planos:${planos}` : ""}`;
  }
  const ativar = d.indicacao === "plano" && d.plano
    ? `Para manter o acesso da sua equipe sem interrupção, ative o plano *${d.plano}*${d.detalhePlano ? ` (${d.detalhePlano})` : ""} por Pix ou cartão:`
    : "Para manter o acesso sem interrupção, escolha seu plano e ative por Pix ou cartão:";
  return `${abertura}\n\n${ativar}${planos}\n\nPrecisa de apoio com a implantação na sua operação? ${RESPONDER[0].toUpperCase()}${RESPONDER.slice(1)}.`;
}

/** Texto do WhatsApp por estágio. `null` = estágio sem versão para WhatsApp. */
export function mensagemWhatsapp(stage: string, d: WaDados): string | null {
  const pagar = d.link ? `\n👉 ${d.link}` : "";
  const planos = d.linkPlanos ? `\n👉 ${d.linkPlanos}` : "";
  const exportar = d.linkExportacao ? `\n👉 ${d.linkExportacao}` : "";
  switch (stage) {
    // ---------- teste grátis ----------
    case "trial_d5":
      return avisoRetaFinal(d, planos);
    case "trial_d7":
      return ultimoDiaTeste(d, planos);
    case "trial_pos_1":
      return `${ola(d)} Tudo bem? O teste gratuito da *${emp(d)}* no AVETO 360 foi encerrado, mas todos os seus dados${d.indicacao === "sem_equipe" ? "" : ", colaboradores"} e cadastros continuam *100% salvos e seguros*.${ind(d)}\n\nPara não perder o ritmo da operação, você ativa ${d.indicacao === "plano" ? "o plano indicado" : "seu plano"} em 1 minuto, por Pix ou cartão:${planos}${rodape}`;
    case "trial_pos_4":
      return `${ola(d)} Sabemos como a rotina do restaurante é corrida.\n\nA contratação da *${emp(d)}* ainda não foi concluída. ${d.indicacao === "sem_equipe" ? "Ficou alguma dúvida para cadastrar a equipe?" : "Ficou alguma dúvida para seguir com a implantação?"}${d.indicacao === "sem_equipe" ? "" : ind(d)}\n\nAo ativar seu plano, nosso time apoia você na configuração inicial para você não perder tempo com digitação.${planos}${rodape}`;
    case "trial_pos_8":
      return `${ola(d)} Este é nosso último contato sobre o teste da *${emp(d)}*.\n\nSe o controle de folgas sem passivo e a clareza do caixa ainda são prioridade este mês, ainda dá tempo de reativar.${ind(d)}${planos}\n\nSe decidiu não seguir agora, tudo bem! Seus dados ficam guardados caso queira retomar. Um abraço da equipe AVETO 360.`;

    // ---------- carência / cortesia ----------
    case "oferta_plano":
      return `${ola(d)} Tudo bem? O acesso${mod(d)} da *${emp(d)}* no AVETO 360 está pausado desde o fim da carência, mas todos os dados continuam salvos.\n\nPelo tamanho da sua equipe, o plano indicado é o *${d.plano ?? "Enterprise"}*${d.detalhePlano ? ` (${d.detalhePlano})` : ""}. A ativação leva 1 minuto, por Pix ou cartão, e libera o acesso na hora:${planos}${rodape}`;
    case "cortesia_encerrada":
      return `${ola(d)} A cortesia${mod(d)} da *${emp(d)}* no AVETO 360 foi encerrada. Liberamos uma carência até *${d.data ?? "os próximos dias"}* para você escolher um plano sem interrupção.${ind(d)}${planos}${rodape}`;
    case "grace_d_menos_3":
      return `${ola(d)} A carência${mod(d)} da *${emp(d)}* termina em *${d.data ?? "3 dias"}*.${ind(d)}\n\nPara manter o acesso, ${escolha(d, "escolha um plano")}:${planos}${rodape}`;
    case "grace_d_menos_1":
      return `${ola(d)} Amanhã (${d.data ?? ""}) termina a carência${mod(d)} da *${emp(d)}*. Depois disso o acesso fica pausado até a contratação.${ind(d)}${planos}${rodape}`;
    case "grace_d0":
      return `${ola(d)} Hoje é o último dia da carência${mod(d)} da *${emp(d)}*. A partir de amanhã o acesso fica pausado, com os dados guardados.${ind(d)}${planos}${rodape}`;

    // ---------- mensalidade ----------
    case "d_menos_3":
      return `${ola(d)} A mensalidade do AVETO 360 da *${emp(d)}*, de *${val(d)}*, vence em *${d.data ?? "breve"}*. Pague por Pix, boleto ou cartão:${pagar}\n\nSe já pagou, desconsidere.`;
    case "d_0":
      return `${ola(d)} A mensalidade da *${emp(d)}*, de *${val(d)}*, vence hoje. Pague por Pix, boleto ou cartão:${pagar}\n\nSe já pagou, desconsidere.`;
    case "d_mais_1":
      return `${ola(d)} Ainda não identificamos o pagamento da fatura de *${val(d)}*, vencida em ${d.data ?? "—"}. O acesso continua normal. Regularize por aqui:${pagar}${rodape}`;
    case "d_mais_5":
      return `${ola(d)} Lembrete: a fatura de *${val(d)}* da *${emp(d)}*, vencida em ${d.data ?? "—"}, segue em aberto. O acesso da equipe continua liberado:${pagar}${rodape}`;
    case "d_mais_8":
      return `${ola(d)} A fatura de *${val(d)}* está em atraso há 8 dias. Para evitar a pausa do acesso da *${emp(d)}* em *${d.dataSuspensao ?? "3 dias"}*, pague até lá:${pagar}\n\nO Portal do Colaborador continua disponível para a equipe.`;
    case "d_mais_10":
      return `${ola(d)} Se o pagamento da fatura de *${val(d)}* não for identificado até amanhã, o acesso operacional da *${emp(d)}* será pausado:${pagar}${rodape}`;
    case "d_mais_11":
      return `${ola(d)} O acesso operacional da *${emp(d)}* foi pausado por pendência na fatura de *${val(d)}*. Os dados estão preservados e o acesso volta automaticamente após o pagamento:${pagar}`;
    case "d_mais_20":
      return `${ola(d)} O acesso da *${emp(d)}* segue pausado pela fatura de *${val(d)}*. Sem a quitação, o contrato será encerrado em *${d.dataRescisao ?? "—"}*:${pagar}${rodape}`;
    case "d_mais_28":
      return `${ola(d)} Em 3 dias (${d.dataRescisao ?? "—"}) o contrato da *${emp(d)}* será encerrado por pendência na fatura de *${val(d)}*. Para manter o contrato:${pagar}${rodape}`;
    case "d_mais_31":
      return `${ola(d)} Enviamos por e-mail a notificação formal de encerramento do contrato da *${emp(d)}*. Os dados ficam disponíveis para exportação até *${d.dataExpiracao ?? "—"}*. Para regularizar e reativar:${pagar}`;
    case "d_mais_60":
      return `${ola(d)} Os dados da *${emp(d)}* seguem disponíveis para exportação até *${d.dataExpiracao ?? "—"}*:${exportar}${rodape}`;
    case "d_mais_80":
      return `${ola(d)} Últimos 10 dias: em *${d.dataExpiracao ?? "breve"}* os dados da *${emp(d)}* deixam de estar disponíveis. Exporte agora:${exportar}${rodape}`;
    case "d_mais_90":
      return `${ola(d)} O prazo de guarda dos dados da *${emp(d)}* foi encerrado. Se quiser voltar ao AVETO 360, é só escolher um plano:${planos}`;

    // ---------- confirmação ----------
    case "reativacao":
      return `${ola(d)} Pagamento de *${val(d)}* confirmado! O acesso da *${emp(d)}* ao AVETO 360 segue liberado. Obrigado! 💚`;
    default:
      return null;
  }
}
