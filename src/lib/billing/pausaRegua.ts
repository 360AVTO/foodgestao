// Pausa da régua por negociação (Backoffice): opções rápidas e fim da pausa.
// Enquanto a pausa vale, o servidor não enfileira nem envia avisos automáticos
// daquela assinatura (e-mail e WhatsApp); a confirmação de pagamento continua.

export const OPCOES_PAUSA_DIAS = [3, 7, 15] as const;
export const MOTIVO_NEGOCIACAO = "Em negociação comercial com a equipe";

const BRT_MS = 3 * 3600 * 1000; // Brasil sem horário de verão (UTC-3)

/** Pausa "por N dias" vale até o fim do N-ésimo dia (23:59:59 em Brasília). */
export function fimDaPausa(dias: number, agora: Date = new Date()): Date {
  const n = Math.max(1, Math.min(180, Math.round(dias)));
  const local = new Date(agora.getTime() - BRT_MS);
  const fim = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + n, 23, 59, 59);
  return new Date(fim + BRT_MS);
}

export function pausaAtiva(ate: string | null | undefined, agora: Date = new Date()): boolean {
  if (!ate) return false;
  const t = new Date(ate).getTime();
  return !Number.isNaN(t) && t > agora.getTime();
}
