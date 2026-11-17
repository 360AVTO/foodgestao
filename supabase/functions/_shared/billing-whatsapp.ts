// Régua de cobrança e do teste pelo WhatsApp da Aveto 360 — regras puras.
// O e-mail segue como aviso oficial; o WhatsApp é o lembrete de conveniência,
// com tom cordial e sem exposição (art. 42 do CDC).
import { normalizeBRPhone } from "./zapi.ts";

export type WaDados = {
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
  plano?: string;
  detalhePlano?: string;
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

export type DestinoWa = { phone: string; nome: string | null; papel: "dono" | "financeiro" };

/** Dono primeiro; o financeiro só entra se for outro número. Inválidos ficam de fora. */
export function destinosWhatsapp(
  dono: { telefone?: string | null; nome?: string | null },
  financeiro: { telefone?: string | null },
): DestinoWa[] {
  const saida: DestinoWa[] = [];
  const d = normalizeBRPhone(dono.telefone ?? null);
  if (d) saida.push({ phone: d, nome: dono.nome ?? null, papel: "dono" });
  const f = normalizeBRPhone(financeiro.telefone ?? null);
  if (f && f !== d) saida.push({ phone: f, nome: null, papel: "financeiro" });
  return saida;
}

const ola = (d: WaDados) => (d.nome ? `Olá, ${d.nome}!` : "Olá!");
const emp = (d: WaDados) => d.empresa || "sua empresa";
const val = (d: WaDados) => d.valor || "em aberto";
const mod = (d: WaDados) => (d.modulo ? ` do ${d.modulo}` : "");
const rodape = `\n\nDúvidas? Fale com nosso atendimento: ${ATENDIMENTO}`;

/** Texto do WhatsApp por estágio. `null` = estágio sem versão para WhatsApp. */
export function mensagemWhatsapp(stage: string, d: WaDados): string | null {
  const pagar = d.link ? `\n👉 ${d.link}` : "";
  const planos = d.linkPlanos ? `\n👉 ${d.linkPlanos}` : "";
  const exportar = d.linkExportacao ? `\n👉 ${d.linkExportacao}` : "";
  switch (stage) {
    // ---------- teste grátis ----------
    case "trial_d5":
      return `${ola(d)} O teste grátis da *${emp(d)}* no AVETO 360 termina em 2 dias${d.data ? ` (${d.data})` : ""}.\n\nPara continuar sem interrupção, escolha seu plano:${planos}${rodape}`;
    case "trial_d7":
      return `${ola(d)} Hoje é o último dia do teste grátis da *${emp(d)}* no AVETO 360.\n\nEscolha seu plano para manter a operação organizada:${planos}${rodape}`;
    case "trial_pos_1":
      return `${ola(d)} Tudo bem? O teste gratuito da *${emp(d)}* no AVETO 360 foi encerrado, mas todos os seus dados, colaboradores e cadastros continuam *100% salvos e seguros*.\n\nPara não perder o ritmo da operação, você ativa seu plano em 1 minuto, por Pix ou cartão:${planos}${rodape}`;
    case "trial_pos_4":
      return `${ola(d)} Sabemos como a rotina do restaurante é corrida.\n\nA contratação da *${emp(d)}* ainda não foi concluída. Ficou alguma dúvida na importação da equipe, na escala de folgas ou no financeiro?\n\nAo ativar seu plano, nosso time apoia você na configuração inicial para você não perder tempo com digitação.${planos}${rodape}`;
    case "trial_pos_8":
      return `${ola(d)} Este é nosso último contato sobre o teste da *${emp(d)}*.\n\nSe o controle de folgas sem passivo e a clareza do caixa ainda são prioridade este mês, ainda dá tempo de reativar:${planos}\n\nSe decidiu não seguir agora, tudo bem! Seus dados ficam guardados caso queira retomar. Um abraço da equipe AVETO 360.`;

    // ---------- carência / cortesia ----------
    case "oferta_plano":
      return `${ola(d)} Tudo bem? O acesso${mod(d)} da *${emp(d)}* no AVETO 360 está pausado desde o fim da carência, mas todos os dados continuam salvos.\n\nPelo tamanho da sua equipe, o plano indicado é o *${d.plano ?? "Enterprise"}*${d.detalhePlano ? ` (${d.detalhePlano})` : ""}. A ativação leva 1 minuto, por Pix ou cartão, e libera o acesso na hora:${planos}${rodape}`;
    case "cortesia_encerrada":
      return `${ola(d)} A cortesia${mod(d)} da *${emp(d)}* no AVETO 360 foi encerrada. Liberamos uma carência até *${d.data ?? "os próximos dias"}* para você escolher um plano sem interrupção:${planos}${rodape}`;
    case "grace_d_menos_3":
      return `${ola(d)} A carência${mod(d)} da *${emp(d)}* termina em *${d.data ?? "3 dias"}*. Escolha um plano para manter o acesso:${planos}${rodape}`;
    case "grace_d_menos_1":
      return `${ola(d)} Amanhã (${d.data ?? ""}) termina a carência${mod(d)} da *${emp(d)}*. Depois disso o acesso fica pausado até a contratação:${planos}${rodape}`;
    case "grace_d0":
      return `${ola(d)} Hoje é o último dia da carência${mod(d)} da *${emp(d)}*. A partir de amanhã o acesso fica pausado, com os dados guardados:${planos}${rodape}`;

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
