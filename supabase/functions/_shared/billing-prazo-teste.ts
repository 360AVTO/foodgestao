// Prazo do teste nos avisos da reta final (3 dias antes e último dia).
// Quando o dia certo cai no fim de semana, o aviso sai num dia útil próximo;
// por isso o texto usa os dias que realmente faltam, nunca um número fixo.

const SEMANA = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** "21/11/2026" → { ddmm: "21/11", semana: "sábado" } */
function partes(data?: string | null): { ddmm: string; semana: string } | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(data ?? "").trim());
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  if (Number.isNaN(dt.getTime())) return null;
  return { ddmm: `${m[1]}/${m[2]}`, semana: SEMANA[dt.getUTCDay()] };
}

/**
 * Complemento de "encerra …": "hoje", "amanhã, sábado (21/11)", "em 3 dias (21/11)".
 * `diasRestantes` ausente usa a data, se houver.
 */
export function prazoDoTeste(diasRestantes: number | null | undefined, data?: string | null): string {
  const p = partes(data);
  const n = typeof diasRestantes === "number" && Number.isFinite(diasRestantes) ? Math.max(0, Math.round(diasRestantes)) : null;
  if (n === 0) return "hoje";
  if (n === 1) return p ? `amanhã, ${p.semana} (${p.ddmm})` : "amanhã";
  if (n !== null) return p ? `em ${n} dias (${p.ddmm})` : `em ${n} dias`;
  return p ? `em ${p.ddmm}` : "em breve";
}
