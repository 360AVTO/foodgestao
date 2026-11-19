import { assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert@1";
import { codigoCertificado } from "./certificado-registro.ts";

Deno.test("código do certificado tem formato XXXX-XXXX-XXXX e é estável por chave", async () => {
  const a = await codigoCertificado("empresa/certificados/doc-aceite-r8.pdf");
  assertMatch(a, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  assertEquals(a, await codigoCertificado("empresa/certificados/doc-aceite-r8.pdf"));
});

Deno.test("nova versão do certificado recebe outro código", async () => {
  assertNotEquals(
    await codigoCertificado("empresa/certificados/doc-aceite-v1-r8.pdf"),
    await codigoCertificado("empresa/certificados/doc-aceite-v2-r8.pdf"),
  );
});
