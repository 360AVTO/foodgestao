// Final do WhatsApp exibido na recuperação de senha.
// Mostra só os 2 últimos dígitos. Quando a conta não existe ou não tem WhatsApp
// válido, devolve 2 dígitos determinísticos derivados do identificador (HMAC),
// para que a resposta tenha sempre o mesmo formato e não revele se o cadastro existe.

export function mascararFinal(digitos: string): string {
  return `••${digitos}`;
}

export async function finalTelefoneRecuperacao(
  telefoneNormalizado: string | null,
  identificadorHash: string,
  segredo: string,
): Promise<string> {
  const d = (telefoneNormalizado ?? "").replace(/\D/g, "");
  if (d.length >= 10) return mascararFinal(d.slice(-2));
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(segredo),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const assinatura = new Uint8Array(
    await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(`recuperacao-final:${identificadorHash}`)),
  );
  const n = ((assinatura[0] << 8) | assinatura[1]) % 100;
  return mascararFinal(String(n).padStart(2, "0"));
}
