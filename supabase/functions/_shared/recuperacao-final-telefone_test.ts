import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { finalTelefoneRecuperacao } from "./recuperacao-final-telefone.ts";

Deno.test("conta com WhatsApp mostra só os 2 últimos dígitos reais", async () => {
  assertEquals(await finalTelefoneRecuperacao("5562992573652", "abc", "s"), "••52");
});

Deno.test("conta inexistente ou sem WhatsApp recebe final no mesmo formato", async () => {
  const r = await finalTelefoneRecuperacao(null, "hash-x", "segredo");
  assertMatch(r, /^••\d{2}$/);
});

Deno.test("final de conta inexistente é estável para o mesmo identificador", async () => {
  const a = await finalTelefoneRecuperacao(null, "hash-y", "segredo");
  const b = await finalTelefoneRecuperacao(null, "hash-y", "segredo");
  assertEquals(a, b);
});
