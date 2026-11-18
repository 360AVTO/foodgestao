import { assertEquals } from "jsr:@std/assert@1";
import { prazoDoTeste } from "./billing-prazo-teste.ts";

Deno.test("prazo do teste usa os dias que realmente faltam", () => {
  assertEquals(prazoDoTeste(3, "19/11/2026"), "em 3 dias (19/11)");
  assertEquals(prazoDoTeste(4, "24/11/2026"), "em 4 dias (24/11)");
  assertEquals(prazoDoTeste(1, "21/11/2026"), "amanhã, sábado (21/11)");
  assertEquals(prazoDoTeste(2, "22/11/2026"), "em 2 dias (22/11)");
  assertEquals(prazoDoTeste(0, "19/11/2026"), "hoje");
  assertEquals(prazoDoTeste(undefined, "19/11/2026"), "em 19/11");
  assertEquals(prazoDoTeste(undefined, null), "em breve");
});
