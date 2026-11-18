import { assertEquals } from "jsr:@std/assert@1";
import {
  comDesconto, hojeBrasilia, janelaDesconto, mensalidadeDeveVoltar, percentualExcedente, somarMeses,
} from "./billing-desconto-negociado.ts";

// Caso Rancho 330: Enterprise R$ 10,00 por colaborador, 47 ativos, 10% nas 3 primeiras mensalidades.
Deno.test("10% deixa o colaborador do Enterprise em R$ 9,00", () => {
  assertEquals(comDesconto(1000, 10), 900);
});

Deno.test("10% deixa a base do Enterprise (19 colaboradores) em R$ 171,00", () => {
  assertEquals(comDesconto(19000, 10), 17100);
});

Deno.test("47 colaboradores com 10%: R$ 171,00 de base + 28 × R$ 9,00 = R$ 423,00", () => {
  assertEquals(comDesconto(19000, 10) + 28 * comDesconto(1000, 10), 42300);
});

Deno.test("contratação em 19/11 com 1º vencimento em 20/11: desconto até o vencimento de 20/01", () => {
  assertEquals(janelaDesconto("2026-11-19", "2026-11-20", 3), {
    competencia_inicial: "2026-11-01", competencia_final: "2027-01-01", ultimo_vencimento_com_desconto: "2027-01-20",
  });
});

const aplicado = {
  id: "d1", percentual: 10, mensalidades: 3, subscription_id: "s1",
  competencia_inicial: "2026-11-01", competencia_final: "2027-01-01", ultimo_vencimento_com_desconto: "2027-01-20",
};

Deno.test("excedentes de nov/2026, dez/2026 e jan/2027 saem com 10%", () => {
  assertEquals(["2026-11-01", "2026-12-01", "2027-01-01"].map((c) => percentualExcedente(aplicado, c)), [10, 10, 10]);
});

Deno.test("excedente de fev/2027 volta ao preço de tabela", () => {
  assertEquals(percentualExcedente(aplicado, "2027-02-01"), 0);
});

Deno.test("desconto revogado não reduz o excedente", () => {
  assertEquals(percentualExcedente({ ...aplicado, revogado_em: "2026-12-05T10:00:00Z" }, "2026-12-01"), 0);
});

Deno.test("desconto ainda não aplicado a uma assinatura não reduz o excedente", () => {
  assertEquals(percentualExcedente({ ...aplicado, subscription_id: null }, "2026-12-01"), 0);
});

Deno.test("mensalidade continua com desconto até o dia do 3º vencimento", () => {
  assertEquals(mensalidadeDeveVoltar(aplicado, "2027-01-20"), false);
});

Deno.test("mensalidade volta ao valor cheio no dia seguinte ao 3º vencimento", () => {
  assertEquals(mensalidadeDeveVoltar(aplicado, "2027-01-21"), true);
});

Deno.test("desconto já encerrado não é processado de novo", () => {
  assertEquals(mensalidadeDeveVoltar({ ...aplicado, encerrado_em: "2027-01-21T11:30:00Z" }, "2027-02-10"), false);
});

Deno.test("revogação volta a mensalidade mesmo dentro da janela", () => {
  assertEquals(mensalidadeDeveVoltar({ ...aplicado, revogado_em: "2026-12-01T10:00:00Z" }, "2026-12-02"), true);
});

Deno.test("somar meses respeita o fim do mês", () => {
  assertEquals(somarMeses("2027-01-31", 1), "2027-02-28");
});

Deno.test("hoje em Brasília vira o dia às 03:00 UTC", () => {
  assertEquals(hojeBrasilia(new Date("2026-11-19T02:59:00Z")), "2026-11-18");
});
