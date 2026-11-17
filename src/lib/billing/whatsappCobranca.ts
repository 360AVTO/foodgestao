// WhatsApp do responsável financeiro — mesma regra do banco
// (billing_v2_whatsapp_cobranca_definir): DDD + número, gravado com 55.

export type WhatsappValidado = { ok: true; valor: string | null } | { ok: false; erro: string };

export function validarWhatsappCobranca(raw: string | null | undefined): WhatsappValidado {
  let d = String(raw ?? "").replace(/\D+/g, "");
  if (!d) return { ok: true, valor: null };
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!(d.length === 12 || d.length === 13) || !d.startsWith("55")) {
    return { ok: false, erro: "Informe DDD e número, por exemplo (62) 99999-9999." };
  }
  const ddd = Number(d.slice(2, 4));
  if (ddd < 11 || ddd > 99 || ddd % 10 === 0) return { ok: false, erro: "DDD inválido. Confira o número com DDD." };
  return { ok: true, valor: d };
}

/** 5562999990001 → (62) 99999-0001 */
export function formatarWhatsapp(digits: string | null | undefined): string {
  const d = String(digits ?? "").replace(/\D+/g, "");
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return d;
}
