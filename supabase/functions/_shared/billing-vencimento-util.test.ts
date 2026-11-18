import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  diaUtilBancario, marcoWhatsappFatura, marcoWhatsappPosFim, pascoa, respeitaIntervalo, somaDiasUteis,
  vencimentoUtil,
} from "./billing-vencimento-util.ts";

const brt = (iso: string) => new Date(`${iso}-03:00`);
const stage = (m: { stage: string } | null) => m?.stage ?? null;

Deno.test("Páscoa: 2026 em 05/04 e 2027 em 28/03", () => {
  assertEquals(pascoa(2026), "2026-04-05");
  assertEquals(pascoa(2027), "2027-03-28");
});

Deno.test("vencimento em feriado (20/11/2026, Consciência Negra) vai para segunda 23/11", () => {
  assertEquals(vencimentoUtil("2026-11-20"), "2026-11-23");
});

Deno.test("vencimento no sábado ou domingo vai para segunda", () => {
  assertEquals(vencimentoUtil("2026-11-28"), "2026-11-30");
  assertEquals(vencimentoUtil("2026-11-29"), "2026-11-30");
});

Deno.test("Carnaval, Sexta-feira Santa e Corpus Christi não são dias úteis bancários", () => {
  for (const d of ["2027-02-08", "2027-02-09", "2027-03-26", "2027-05-27", "2026-04-03", "2026-06-04"]) {
    assert(!diaUtilBancario(d), d);
  }
  // sábado antes do Carnaval de 2027 vence na quarta-feira de cinzas
  assertEquals(vencimentoUtil("2027-02-06"), "2027-02-10");
});

Deno.test("dia útil comum continua o próprio vencimento", () => {
  assertEquals(vencimentoUtil("2026-11-18"), "2026-11-18");
  assertEquals(somaDiasUteis("2026-11-23", -2), "2026-11-18");
  assertEquals(somaDiasUteis("2026-11-23", 4), "2026-11-27");
});

// Rancho 330: boleto com vencimento 20/11/2026 (feriado) → vencimento útil 23/11
const RANCHO = { vencimento: "2026-11-20", forma: "boleto", criadaEm: "2026-11-10" };

Deno.test("boleto/Pix: 1 lembrete 2 dias úteis antes do vencimento útil", () => {
  assertEquals(stage(marcoWhatsappFatura(RANCHO, "2026-11-17")), null);
  assertEquals(stage(marcoWhatsappFatura(RANCHO, "2026-11-18")), "wa_mensalidade_lembrete");
  // perdeu a janela: ainda vale até a véspera do vencimento útil
  assertEquals(marcoWhatsappFatura(RANCHO, "2026-11-18")!.validoAte.toISOString(), brt("2026-11-22T23:59:59.999").toISOString());
});

Deno.test("no dia do vencimento útil: silêncio", () => {
  assertEquals(marcoWhatsappFatura(RANCHO, "2026-11-23"), null);
});

Deno.test("prorrogação legal: nada de cobrança no feriado nem no fim de semana após ele", () => {
  for (const d of ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"]) {
    assertEquals(stage(marcoWhatsappFatura(RANCHO, d)), null, d);
  }
});

Deno.test("em aberto: 1 contato 4 dias úteis depois do vencimento útil", () => {
  assertEquals(stage(marcoWhatsappFatura(RANCHO, "2026-11-27")), "wa_mensalidade_em_aberto");
  assertEquals(stage(marcoWhatsappFatura({ ...RANCHO, forma: "pix" }, "2026-11-27")), "wa_mensalidade_em_aberto");
  // forma desconhecida segue a regra do boleto
  assertEquals(stage(marcoWhatsappFatura({ ...RANCHO, forma: null }, "2026-11-27")), "wa_mensalidade_em_aberto");
  // depois de D+9 o WhatsApp não insiste (o aviso formal de pausa sai por e-mail)
  assertEquals(marcoWhatsappFatura(RANCHO, "2026-11-30"), null);
});

Deno.test("fatura recém-criada (contratação) não recebe lembrete antes do vencimento", () => {
  assertEquals(marcoWhatsappFatura({ ...RANCHO, criadaEm: "2026-11-19" }, "2026-11-19"), null);
  assertEquals(stage(marcoWhatsappFatura({ ...RANCHO, criadaEm: "2026-11-19" }, "2026-11-27")), "wa_mensalidade_em_aberto");
});

Deno.test("cartão: nenhum lembrete; só se não confirmar em 3 dias úteis", () => {
  const cartao = { vencimento: "2026-12-10", forma: "card", criadaEm: "2026-11-30" };
  for (const d of ["2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-14"]) {
    assertEquals(marcoWhatsappFatura(cartao, d), null, d);
  }
  assertEquals(stage(marcoWhatsappFatura(cartao, "2026-12-15")), "wa_cartao_nao_confirmado");
});

Deno.test("pós-teste/carência: 2 toques (D+2 e D+6) e depois silêncio", () => {
  const fim = "2026-11-16"; // Praianos
  assertEquals(marcoWhatsappPosFim(fim, "2026-11-17"), null);
  assertEquals(stage(marcoWhatsappPosFim(fim, "2026-11-18")), "wa_pos_fim_1");
  assertEquals(stage(marcoWhatsappPosFim(fim, "2026-11-21")), "wa_pos_fim_1");
  assertEquals(stage(marcoWhatsappPosFim(fim, "2026-11-22")), "wa_pos_fim_2");
  assertEquals(stage(marcoWhatsappPosFim(fim, "2026-11-24")), "wa_pos_fim_2");
  assertEquals(marcoWhatsappPosFim(fim, "2026-11-25"), null);
  assertEquals(marcoWhatsappPosFim(fim, "2026-12-20"), null);
});

Deno.test("nunca dois WhatsApps da régua em dias seguidos para o mesmo número", () => {
  const novo = brt("2026-11-24T09:30:00");
  assertEquals(respeitaIntervalo(novo, [brt("2026-11-23T15:00:00")]), false);
  assertEquals(respeitaIntervalo(novo, [brt("2026-11-24T08:00:00")]), false);
  assertEquals(respeitaIntervalo(novo, [brt("2026-11-22T10:00:00")]), true);
  assertEquals(respeitaIntervalo(novo, []), true);
});
