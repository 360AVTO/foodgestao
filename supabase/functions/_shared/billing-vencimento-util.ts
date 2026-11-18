// Vencimento útil bancário e marcos da régua de relacionamento por WhatsApp — regras puras.
//
// Boleto/Pix com vencimento em sábado, domingo ou feriado bancário nacional pode ser
// pago no 1º dia útil seguinte sem encargos (Lei 7.089/1983; calendário FEBRABAN).
// A régua conta os dias a partir desse vencimento útil — nunca cobra quem ainda está no prazo.
//
// Espelho no banco: public.billing_feriado_bancario / public.billing_vencimento_util.

export type Iso = string; // YYYY-MM-DD

const DIA_MS = 24 * 3600 * 1000;
const BRT_MS = 3 * 3600 * 1000; // Brasil sem horário de verão (UTC-3)

const FIXOS = new Set(["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"]);

const paraData = (iso: Iso) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);
const paraIso = (d: Date) => d.toISOString().slice(0, 10);

export function somaDias(iso: Iso, dias: number): Iso {
  return paraIso(new Date(paraData(iso).getTime() + dias * DIA_MS));
}

export function diferencaDias(de: Iso, ate: Iso): number {
  return Math.round((paraData(ate).getTime() - paraData(de).getTime()) / DIA_MS);
}

/** Domingo de Páscoa (algoritmo de Meeus/Butcher, calendário gregoriano). */
export function pascoa(ano: number): Iso {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Feriado nacional sem expediente bancário: fixos + Carnaval (seg/ter), Sexta-feira Santa e Corpus Christi. */
export function feriadoBancario(iso: Iso): boolean {
  if (FIXOS.has(iso.slice(5, 10))) return true;
  const p = pascoa(Number(iso.slice(0, 4)));
  return [-48, -47, -2, 60].some((desl) => somaDias(p, desl) === iso.slice(0, 10));
}

export function diaUtilBancario(iso: Iso): boolean {
  const semana = paraData(iso).getUTCDay();
  return semana !== 0 && semana !== 6 && !feriadoBancario(iso);
}

/** Vencimento legal: a própria data, ou o 1º dia útil bancário seguinte. */
export function vencimentoUtil(iso: Iso): Iso {
  let d = iso.slice(0, 10);
  while (!diaUtilBancario(d)) d = somaDias(d, 1);
  return d;
}

/** Soma (ou subtrai) dias úteis bancários. */
export function somaDiasUteis(iso: Iso, n: number): Iso {
  let d = iso.slice(0, 10);
  const passo = n >= 0 ? 1 : -1;
  for (let faltam = Math.abs(n); faltam > 0;) {
    d = somaDias(d, passo);
    if (diaUtilBancario(d)) faltam--;
  }
  return d;
}

/** Data de hoje em Brasília. */
export function hojeBRT(agora: Date): Iso {
  return paraIso(new Date(agora.getTime() - BRT_MS));
}

/** 23h59m59s de uma data em Brasília. */
export function fimDoDiaBRT(iso: Iso): Date {
  return new Date(Date.parse(`${iso.slice(0, 10)}T23:59:59.999Z`) + BRT_MS);
}

// ---------------------------------------------------------------------------
// Marcos do WhatsApp (no máximo 2 toques por ciclo; o e-mail segue como aviso oficial)
// ---------------------------------------------------------------------------

export const WA_MENSALIDADE_LEMBRETE = "wa_mensalidade_lembrete";
export const WA_MENSALIDADE_EM_ABERTO = "wa_mensalidade_em_aberto";
export const WA_CARTAO_NAO_CONFIRMADO = "wa_cartao_nao_confirmado";
export const WA_POS_FIM_1 = "wa_pos_fim_1";
export const WA_POS_FIM_2 = "wa_pos_fim_2";

export const MARCOS_WA = {
  /** Boleto/Pix: 1 lembrete, 2 dias úteis antes do vencimento útil. No vencimento, silêncio. */
  lembreteDiasUteisAntes: 2,
  /** Boleto/Pix: só se seguir em aberto 4 dias úteis depois do vencimento útil. */
  emAbertoDiasUteisDepois: 4,
  /** Cartão: nada antes; só se a cobrança não confirmar em 3 dias úteis. */
  cartaoDiasUteisDepois: 3,
  /** Pós-teste / pós-carência: 2 toques, em dias corridos após o encerramento. */
  posFim: [2, 6] as const,
  /** Tolerância para recuperar um toque que não pôde sair no dia exato. */
  folgaDias: 3,
  /** Depois disso a régua formal (e-mail de aviso de pausa) assume; WhatsApp não insiste. */
  limiteAposVencimento: 9,
} as const;

export type Marco = { stage: string; validoAte: Date; dias: number };

export type FaturaWa = {
  vencimento: Iso;
  forma: string | null | undefined;
  /** Data (Brasília) em que a fatura passou a existir aqui. */
  criadaEm?: Iso | null;
};

/** Marco do WhatsApp para uma fatura em aberto hoje, ou null (silêncio). */
export function marcoWhatsappFatura(f: FaturaWa, hoje: Iso): Marco | null {
  const venc = f.vencimento.slice(0, 10);
  const util = vencimentoUtil(venc);
  const limite = somaDias(venc, MARCOS_WA.limiteAposVencimento);
  const dias = diferencaDias(util, hoje);

  if (f.forma === "card") {
    const alvo = somaDiasUteis(util, MARCOS_WA.cartaoDiasUteisDepois);
    const ate = [somaDias(alvo, MARCOS_WA.folgaDias), limite].sort()[0];
    if (hoje >= alvo && hoje <= ate) return { stage: WA_CARTAO_NAO_CONFIRMADO, validoAte: fimDoDiaBRT(ate), dias };
    return null;
  }

  const alvoLembrete = somaDiasUteis(util, -MARCOS_WA.lembreteDiasUteisAntes);
  const vespera = somaDias(util, -1);
  // Fatura que acabou de nascer (ex.: contratação de hoje) já foi vista no checkout: sem lembrete.
  const nasceuAntes = !f.criadaEm || f.criadaEm.slice(0, 10) < alvoLembrete;
  if (hoje >= alvoLembrete && hoje <= vespera) {
    return nasceuAntes ? { stage: WA_MENSALIDADE_LEMBRETE, validoAte: fimDoDiaBRT(vespera), dias } : null;
  }

  const alvoAberto = somaDiasUteis(util, MARCOS_WA.emAbertoDiasUteisDepois);
  const ate = [somaDias(alvoAberto, MARCOS_WA.folgaDias), limite].sort()[0];
  if (hoje >= alvoAberto && hoje <= ate) return { stage: WA_MENSALIDADE_EM_ABERTO, validoAte: fimDoDiaBRT(ate), dias };
  return null;
}

/** Marco do WhatsApp após o fim do teste/carência sem contratação, ou null. */
export function marcoWhatsappPosFim(fim: Iso, hoje: Iso): Marco | null {
  const dias = diferencaDias(fim.slice(0, 10), hoje);
  const [primeiro, segundo] = MARCOS_WA.posFim;
  if (dias >= primeiro && dias < segundo) {
    return { stage: WA_POS_FIM_1, validoAte: fimDoDiaBRT(somaDias(fim, segundo - 1)), dias };
  }
  if (dias >= segundo && dias <= segundo + MARCOS_WA.folgaDias - 1) {
    return { stage: WA_POS_FIM_2, validoAte: fimDoDiaBRT(somaDias(fim, segundo + MARCOS_WA.folgaDias - 1)), dias };
  }
  return null;
}

/** Não manda dois WhatsApps da régua em dias seguidos para o mesmo número. */
export function respeitaIntervalo(novoEnvio: Date, ultimosEnvios: Date[]): boolean {
  const novo = hojeBRT(novoEnvio);
  return ultimosEnvios.every((d) => Math.abs(diferencaDias(hojeBRT(d), novo)) >= 2);
}
