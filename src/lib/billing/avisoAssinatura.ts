// Balão de fim de teste/carência para os gestores da empresa.
// Regras puras: qual aviso mostrar, quem pode contratar, textos e link do WhatsApp
// da equipe AVETO. O valor final da contratação é sempre calculado pelo servidor.
import type { ModuleAccessV2, ModuloAcesso } from "@/hooks/useModuleAccess";

export const WHATSAPP_EQUIPE_AVETO = "5562992365959";
/** A partir de quantos dias do fim o balão da reta final aparece. */
export const DIAS_RETA_FINAL = 3;

export type FaseAviso = "reta_final" | "encerrado";
export type TipoPeriodo = "teste" | "carencia";

export interface AvisoAssinatura {
  modulo: ModuloAcesso;
  fase: FaseAviso;
  tipo: TipoPeriodo;
  /** Dias de calendário (horário de Brasília) até o fim; 0 = hoje. Encerrado = 0. */
  dias: number;
  fim: string | null;
}

export const ROTULO_MODULO: Record<ModuloAcesso, string> = {
  financeiro: "Financeiro 360°",
  pessoas: "Pessoas 360°",
};

const FUSO = "America/Sao_Paulo";

/** "2026-11-19" no horário de Brasília. */
export function diaBrasilia(d: Date | string): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(dt);
}

/** "19/11" no horário de Brasília. */
export function ddmmBrasilia(d: string | null | undefined): string | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit" }).format(dt);
}

const SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function diasEntre(hoje: string, fim: string): number {
  const a = Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1, +hoje.slice(8, 10));
  const b = Date.UTC(+fim.slice(0, 4), +fim.slice(5, 7) - 1, +fim.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/** Aviso de um módulo, ou null quando não há nada a avisar. */
export function avisoDoModulo(
  modulo: ModuloAcesso,
  a: ModuleAccessV2 | null | undefined,
  agora: Date = new Date(),
): AvisoAssinatura | null {
  if (!a) return null;
  if (!a.allowed) {
    if (a.motivo === "trial_expirado") return { modulo, fase: "encerrado", tipo: "teste", dias: 0, fim: a.trial_ends_at };
    if (a.motivo === "carencia_expirada") return { modulo, fase: "encerrado", tipo: "carencia", dias: 0, fim: a.grace_ends_at };
    return null;
  }
  if (a.dias_atraso && a.dias_atraso > 0) return null;
  let tipo: TipoPeriodo | null = null;
  let fim: string | null = null;
  if (a.grant === "carencia" || (a.status === "grace" && !a.grant)) { tipo = "carencia"; fim = a.grace_ends_at; }
  else if (a.status === "trialing" && !a.grant) { tipo = "teste"; fim = a.trial_ends_at; }
  if (!tipo || !fim) return null;
  const dias = diasEntre(diaBrasilia(agora), diaBrasilia(fim));
  if (dias < 0 || dias > DIAS_RETA_FINAL) return null;
  return { modulo, fase: "reta_final", tipo, dias, fim };
}

/** O aviso mais urgente: encerrado antes da reta final; depois o fim mais próximo; Pessoas antes no empate. */
export function escolherAviso(avisos: Array<AvisoAssinatura | null>): AvisoAssinatura | null {
  const lista = avisos.filter((x): x is AvisoAssinatura => !!x);
  lista.sort((x, y) =>
    (x.fase === "encerrado" ? 0 : 1) - (y.fase === "encerrado" ? 0 : 1)
    || x.dias - y.dias
    || (x.modulo === "pessoas" ? 0 : 1) - (y.modulo === "pessoas" ? 0 : 1));
  return lista[0] ?? null;
}

/** Mesma regra do servidor de contratação: dono da empresa, perfil Dono ou Administrador. */
export function podeContratarAssinatura(p: { ehDonoEmpresa?: boolean | null; role?: string | null }): boolean {
  return !!p.ehDonoEmpresa || p.role === "owner" || p.role === "admin";
}

const nomePeriodo = (t: TipoPeriodo) => (t === "teste" ? "período de teste" : "período de carência");

/** "encerra amanhã, quinta-feira (19/11)" · "encerra hoje" · "encerrou em 16/11". */
export function textoPrazo(av: AvisoAssinatura): string {
  const ddmm = ddmmBrasilia(av.fim);
  if (av.fase === "encerrado") return ddmm ? `encerrou em ${ddmm}` : "encerrou";
  if (av.dias === 0) return "encerra hoje";
  if (av.dias === 1) {
    const sem = av.fim ? SEMANA[new Date(`${diaBrasilia(av.fim)}T12:00:00Z`).getUTCDay()] : null;
    return ddmm && sem ? `encerra amanhã, ${sem} (${ddmm})` : "encerra amanhã";
  }
  return ddmm ? `encerra em ${av.dias} dias (${ddmm})` : `encerra em ${av.dias} dias`;
}

export function tituloAviso(av: AvisoAssinatura): string {
  if (av.fase === "encerrado") return av.tipo === "teste" ? "Período de teste encerrado" : "Período de carência encerrado";
  return av.tipo === "teste" ? "Período de teste perto do fim" : "Período de carência perto do fim";
}

/** Frase principal do balão, só com fatos verificáveis (empresa, data, colaboradores). */
export function textoAviso(av: AvisoAssinatura, empresa: string | null, colaboradores?: number | null): string {
  const emp = empresa ? ` na ${empresa}` : "";
  const base = `O ${nomePeriodo(av.tipo)} do ${ROTULO_MODULO[av.modulo]}${emp} ${textoPrazo(av)}.`;
  const n = Number(colaboradores ?? 0);
  const equipe = av.modulo === "pessoas" && n > 0
    ? ` Os cadastros ${n === 1 ? "do colaborador" : `dos ${n} colaboradores`} e todos os dados continuam salvos e seguros.`
    : " Todos os cadastros e dados continuam salvos e seguros.";
  return base + equipe;
}

/** "SAMANTA SOTERO DE SÁ" → "Samanta". */
export function primeiroNome(nome?: string | null): string | null {
  const p = String(nome ?? "").trim().split(/\s+/)[0];
  if (!p) return null;
  return p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1).toLocaleLowerCase("pt-BR");
}

/** "Silvio" · "Silvio ou Samanta" · "Silvio, Ana ou Samanta". */
export function listaNomes(nomes: string[]): string {
  const l = nomes.filter(Boolean);
  if (l.length <= 1) return l[0] ?? "";
  return `${l.slice(0, -1).join(", ")} ou ${l[l.length - 1]}`;
}

/** Mensagem pré-preenchida para a equipe AVETO, já com o contexto da empresa. */
export function mensagemEquipe(p: {
  aviso: AvisoAssinatura;
  nome?: string | null;
  empresa?: string | null;
  colaboradores?: number | null;
  plano?: string | null;
}): string {
  const quem = primeiroNome(p.nome);
  const emp = p.empresa ? `, da ${p.empresa}` : "";
  const abre = quem ? `Olá! Sou ${quem}${emp}.` : `Olá!${p.empresa ? ` Falo pela ${p.empresa}.` : ""}`;
  const mod = ROTULO_MODULO[p.aviso.modulo];
  const n = Number(p.colaboradores ?? 0);
  const equipe = p.aviso.modulo === "pessoas" && n > 0 ? ` (${n} ${n === 1 ? "colaborador ativo" : "colaboradores ativos"})` : "";
  const plano = p.plano ? ` sobre o plano ${p.plano}` : "";
  if (p.aviso.fase === "encerrado") {
    const com = p.plano ? ` com o plano ${p.plano}` : "";
    return `${abre} O ${nomePeriodo(p.aviso.tipo)} do ${mod} ${textoPrazo(p.aviso)}${equipe} e gostaria de falar com a equipe da AVETO para reativar o acesso${com}.`;
  }
  return `${abre} O ${nomePeriodo(p.aviso.tipo)} do ${mod} está na reta final${equipe} e gostaria de tirar dúvidas${plano} antes de concluir a contratação.`;
}

export function linkWhatsappEquipe(texto: string, numero = WHATSAPP_EQUIPE_AVETO): string {
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/** Chave do "já mostrei hoje nesta sessão" — volta a aparecer no dia seguinte ou ao mudar de fase. */
export function chaveBalao(companyId: string, av: AvisoAssinatura, agora: Date = new Date()): string {
  return `aviso-assinatura:${companyId}:${av.modulo}:${av.fase}:${diaBrasilia(agora)}`;
}

/**
 * Faixa do topo na reta final (atalho depois de fechar o balão):
 * "Período de teste do Pessoas 360° encerra amanhã, quinta-feira (19/11) · 47 colaboradores · Plano indicado: Enterprise".
 */
export function textoFaixaAviso(av: AvisoAssinatura, colaboradores?: number | null, plano?: string | null): string {
  const periodo = av.tipo === "teste" ? "Período de teste" : "Período de carência";
  const partes = [`${periodo} do ${ROTULO_MODULO[av.modulo]} ${textoPrazo(av)}`];
  const n = Number(colaboradores ?? 0);
  if (av.modulo === "pessoas" && n > 0) partes.push(`${n} ${n === 1 ? "colaborador" : "colaboradores"}`);
  if (plano) partes.push(`Plano indicado: ${plano}`);
  return partes.join(" · ");
}
