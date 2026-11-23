// Régua de cobrança e do teste pelo WhatsApp da Aveto 360 — regras puras.
// O e-mail segue como aviso oficial; o WhatsApp é o lembrete de conveniência,
// com tom cordial e sem exposição (art. 42 do CDC).
import { normalizeBRPhone } from "./zapi.ts";
import { trechoIndicacao, type DadosIndicacao } from "./billing-plano-indicado.ts";
import { prazoDoTeste } from "./billing-prazo-teste.ts";
import {
  feriadoBancario, WA_CARTAO_NAO_CONFIRMADO, WA_MENSALIDADE_EM_ABERTO, WA_MENSALIDADE_LEMBRETE,
  WA_POS_FIM_1, WA_POS_FIM_2,
} from "./billing-vencimento-util.ts";

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
  /** Forma de pagamento da fatura (boleto, pix, card). */
  forma?: string | null;
  /** Fim do teste ("teste") ou da carência/cortesia ("carencia"). */
  encerramento?: "teste" | "carencia";
};

/**
 * Estágios que têm WhatsApp. Mensalidade: no máximo 2 toques (lembrete antes do
 * vencimento útil e, se seguir em aberto, 1 contato depois); cartão só se não
 * confirmar; pós-teste/carência: 2 toques. Os demais estágios seguem só por e-mail.
 */
export const ESTAGIOS_WHATSAPP = [
  "trial_d5", "trial_d7", "grace_d_menos_3", "grace_d0", "cortesia_encerrada", "oferta_plano",
  WA_MENSALIDADE_LEMBRETE, WA_MENSALIDADE_EM_ABERTO, WA_CARTAO_NAO_CONFIRMADO, WA_POS_FIM_1, WA_POS_FIM_2,
  "reativacao",
] as const;

export const ATENDIMENTO = "https://wa.me/5562992365959";

/** Avisos que continuam válidos se o envio cair no próximo dia útil. */
const ADIAVEIS = new Set(["reativacao", "oferta_plano", "cortesia_encerrada"]);

const BRT_MS = 3 * 3600 * 1000; // Brasil sem horário de verão (UTC-3)
const MIN = 60 * 1000;

type Janela = [inicioMin: number, fimMin: number];
/** Seg a sex, fora do pico do almoço e do jantar do food service. */
const MANHA: Janela = [9 * 60 + 30, 11 * 60];
const TARDE: Janela = [15 * 60, 16 * 60 + 30];
const JANELAS_COMERCIAIS: Janela[] = [MANHA, TARDE];
/** 1º toque de manhã (antes do almoço); o 2º à tarde (entre o almoço e o jantar). */
const SO_MANHA = new Set<string>([WA_MENSALIDADE_LEMBRETE, WA_POS_FIM_1]);
const SO_TARDE = new Set<string>([WA_MENSALIDADE_EM_ABERTO, WA_CARTAO_NAO_CONFIRMADO, WA_POS_FIM_2]);
/** Confirmação de pagamento: todo dia, em horário civil. */
const JANELAS_CONFIRMACAO: Janela[] = [[8 * 60, 20 * 60]];

function janelasDo(stage: string, diaSemana: number, iso: string): Janela[] {
  if (stage === "reativacao") return JANELAS_CONFIRMACAO;
  // fim de semana e feriado nacional: silêncio total
  if (diaSemana === 0 || diaSemana === 6 || feriadoBancario(iso)) return [];
  if (SO_MANHA.has(stage)) return [MANHA];
  if (SO_TARDE.has(stage)) return [TARDE];
  return JANELAS_COMERCIAIS;
}

/** Próximo instante permitido para mandar o WhatsApp deste estágio. */
export function proximoEnvioWhatsapp(stage: string, agora: Date): Date {
  const local = new Date(agora.getTime() - BRT_MS);
  const meiaNoite = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  for (let d = 0; d < 10; d++) {
    const diaUtc = meiaNoite + d * 24 * 3600 * 1000;
    const dia = new Date(diaUtc);
    for (const [ini, fim] of janelasDo(stage, dia.getUTCDay(), dia.toISOString().slice(0, 10))) {
      const inicio = diaUtc + ini * MIN + BRT_MS;
      const termino = diaUtc + fim * MIN + BRT_MS;
      if (agora.getTime() < termino) return new Date(Math.max(agora.getTime(), inicio));
    }
  }
  return agora;
}

/**
 * Envio avulso autorizado pelo super admin (ex.: antecipar um aviso a pedido do cliente):
 * sai fora da janela comercial, mas só em horário civil (8h–20h, Brasília).
 */
export function proximoEnvioAvulso(agora: Date): Date {
  return proximoEnvioWhatsapp("reativacao", agora);
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

/** Primeiro nome com só a inicial maiúscula ("SAMANTA SILVA" → "Samanta"), também em nomes com hífen. */
export function nomeSaudacao(nome: string | null | undefined): string {
  const p = String(nome ?? "").trim().split(/\s+/)[0] ?? "";
  return p.split("-").map((x) => x ? x.charAt(0).toLocaleUpperCase("pt-BR") + x.slice(1).toLocaleLowerCase("pt-BR") : x).join("-");
}
const ola = (d: WaDados) => (nomeSaudacao(d.nome) ? `Olá, ${nomeSaudacao(d.nome)}!` : "Olá!");
const oi = (d: WaDados) => (nomeSaudacao(d.nome) ? `Oi, ${nomeSaudacao(d.nome)}!` : "Oi!");
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

/** Nome pelo qual o cliente conhece a empresa (nome fantasia, quando houver). */
const comoSeChama = (d: WaDados) => `*${emp(d)}*`;
/** Uma linha com o plano indicado (o link já abre com ele selecionado). */
const planoCurto = (d: WaDados) =>
  d.indicacao === "plano" && d.plano ? `\n\nPelo tamanho da equipe, o plano indicado é o *${d.plano}*.` : "";

/** Texto do WhatsApp por estágio. `null` = estágio só por e-mail. */
export function mensagemWhatsapp(stage: string, d: WaDados): string | null {
  const pagar = d.link ? `\n👉 ${d.link}` : "";
  const planos = d.linkPlanos ? `\n👉 ${d.linkPlanos}` : "";
  switch (stage) {
    // ---------- teste grátis (reta final) ----------
    case "trial_d5":
      return avisoRetaFinal(d, planos);
    case "trial_d7":
      return ultimoDiaTeste(d, planos);

    // ---------- depois do fim do teste ou da carência: 2 toques ----------
    case WA_POS_FIM_1: {
      const acesso = d.encerramento === "carencia"
        ? "Para reativar o acesso da equipe, com todos os dados salvos:"
        : "Para manter o acesso liberado sem pausar a operação:";
      return `${ola(d)} Tudo bem?\n\nPassando para saber como está a rotina da ${comoSeChama(d)} e se podemos te apoiar com a escala da equipe.${planoCurto(d)}\n\n${acesso}${planos}\n\nFicou alguma dúvida ou algo que possamos te ajudar por aí hoje?`;
    }
    case WA_POS_FIM_2:
      return `${oi(d)}\n\nPassando para saber se ficou alguma dúvida sobre a escala ou se prefere conversar sobre o melhor formato para a ${comoSeChama(d)}.\n\nQuando quiser seguir, é por aqui:${planos}\n\nPodemos te ajudar com alguma coisa?`;

    // ---------- carência / cortesia ----------
    case "oferta_plano":
      return `${ola(d)} Tudo bem? O acesso${mod(d)} da *${emp(d)}* no AVETO 360 está pausado desde o fim da carência, mas todos os dados continuam salvos.\n\nPelo tamanho da sua equipe, o plano indicado é o *${d.plano ?? "Enterprise"}*${d.detalhePlano ? ` (${d.detalhePlano})` : ""}. A ativação leva 1 minuto, por Pix ou cartão, e libera o acesso na hora:${planos}${rodape}`;
    case "cortesia_encerrada":
      return `${ola(d)} A cortesia${mod(d)} da *${emp(d)}* no AVETO 360 foi encerrada. Liberamos uma carência até *${d.data ?? "os próximos dias"}* para você escolher um plano sem interrupção.${ind(d)}${planos}${rodape}`;
    case "grace_d_menos_3":
      return `${ola(d)} A carência${mod(d)} da *${emp(d)}* termina em *${d.data ?? "3 dias"}*.${ind(d)}\n\nPara manter o acesso, ${escolha(d, "escolha um plano")}:${planos}${rodape}`;
    case "grace_d0":
      return `${ola(d)} Hoje é o último dia da carência${mod(d)} da *${emp(d)}*. A partir de amanhã o acesso fica pausado, com os dados guardados.${ind(d)}${planos}${rodape}`;

    // ---------- mensalidade: no máximo 2 toques ----------
    case WA_MENSALIDADE_LEMBRETE:
      return `${ola(d)} Tudo bem?\n\nDeixo aqui o link da mensalidade do AVETO 360 da ${comoSeChama(d)} para facilitar seu dia:${pagar}\n\nA escala e os cadastros da equipe estão rodando certinho por aí?`;
    case WA_MENSALIDADE_EM_ABERTO: {
      const pergunta = d.forma === "pix"
        ? "Teve alguma dificuldade com o Pix ou prefere pagar por boleto?"
        : "Teve alguma dificuldade com o boleto ou precisa de uma 2ª via por aqui?";
      return `${oi(d)}\n\nA fatura do AVETO 360 da ${comoSeChama(d)} segue em aberto, mas o acesso da equipe continua 100% liberado.\n\nPara regularizar quando puder:${pagar}\n\n${pergunta}`;
    }
    case WA_CARTAO_NAO_CONFIRMADO:
      return `${oi(d)}\n\nNão conseguimos confirmar no cartão a mensalidade do AVETO 360 da ${comoSeChama(d)}, mas o acesso da equipe continua 100% liberado.\n\nSe preferir, dá para pagar por Pix ou boleto aqui:${pagar}\n\nQuer ajuda para atualizar o cartão por aqui?`;

    // ---------- confirmação ----------
    case "reativacao":
      return `${ola(d)} Pagamento de *${val(d)}* confirmado! O acesso da *${emp(d)}* ao AVETO 360 segue liberado. Obrigado! 💚`;
    default:
      return null;
  }
}
