import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  destinosWhatsapp, mensagemWhatsapp, POS_TESTE_DIAS, proximoEnvioWhatsapp, validadeWhatsapp,
} from "./billing-whatsapp.ts";

// Horários em Brasília (UTC-3)
const brt = (iso: string) => new Date(`${iso}-03:00`);

Deno.test("pós-teste tem 3 tentativas: D+1, D+4 e D+8", () => {
  assertEquals(Object.values(POS_TESTE_DIAS), [1, 4, 8]);
});

Deno.test("antes das 9h30 de um dia útil espera a janela da manhã", () => {
  // 18/11/2026 é quarta-feira
  assertEquals(proximoEnvioWhatsapp("d_0", brt("2026-11-18T08:00:00")).toISOString(), brt("2026-11-18T09:30:00").toISOString());
});

Deno.test("dentro da janela envia na hora", () => {
  const agora = brt("2026-11-18T10:15:00");
  assertEquals(proximoEnvioWhatsapp("trial_pos_1", agora).getTime(), agora.getTime());
});

Deno.test("entre 11h e 15h espera a janela da tarde", () => {
  assertEquals(proximoEnvioWhatsapp("trial_pos_4", brt("2026-11-18T12:00:00")).toISOString(), brt("2026-11-18T15:00:00").toISOString());
});

Deno.test("sábado e domingo ficam para segunda às 9h30", () => {
  // 21/11/2026 é sábado
  assertEquals(proximoEnvioWhatsapp("trial_pos_1", brt("2026-11-21T08:00:00")).toISOString(), brt("2026-11-23T09:30:00").toISOString());
});

Deno.test("depois das 16h30 de sexta vai para segunda", () => {
  assertEquals(proximoEnvioWhatsapp("trial_pos_8", brt("2026-11-20T17:00:00")).toISOString(), brt("2026-11-23T09:30:00").toISOString());
});

Deno.test("confirmação de pagamento sai todo dia entre 8h e 20h", () => {
  const sabado = brt("2026-11-21T10:00:00");
  assertEquals(proximoEnvioWhatsapp("reativacao", sabado).getTime(), sabado.getTime());
  assertEquals(proximoEnvioWhatsapp("reativacao", brt("2026-11-21T22:00:00")).toISOString(), brt("2026-11-22T08:00:00").toISOString());
});

Deno.test("aviso com data do dia vale só até o fim do dia em Brasília", () => {
  assertEquals(validadeWhatsapp("d_0", brt("2026-11-21T08:00:00")).toISOString(), brt("2026-11-21T23:59:59.999").toISOString());
});

Deno.test("tentativas do pós-teste podem esperar até 3 dias", () => {
  const criado = brt("2026-11-21T08:00:00");
  assertEquals(validadeWhatsapp("trial_pos_1", criado).getTime() - criado.getTime(), 3 * 24 * 3600 * 1000);
});

Deno.test("destinatários: dono e financeiro, sem repetir o mesmo número", () => {
  assertEquals(destinosWhatsapp({ telefone: "(62) 99999-0001", nome: "Rafael" }, { telefone: "62999990002" }).map((x) => [x.phone, x.papel]),
    [["5562999990001", "dono"], ["5562999990002", "financeiro"]]);
  assertEquals(destinosWhatsapp({ telefone: "62999990001" }, { telefone: "+55 62 99999-0001" }).length, 1);
  assertEquals(destinosWhatsapp({ telefone: "123" }, { telefone: null }).length, 0);
});

Deno.test("todos os estágios da régua têm mensagem de WhatsApp", () => {
  for (const s of ["trial_d5", "trial_d7", "trial_pos_1", "trial_pos_4", "trial_pos_8", "cortesia_encerrada",
    "grace_d_menos_3", "grace_d_menos_1", "grace_d0", "d_menos_3", "d_0", "d_mais_1", "d_mais_5", "d_mais_8",
    "d_mais_10", "d_mais_11", "d_mais_20", "d_mais_28", "d_mais_31", "d_mais_60", "d_mais_80", "d_mais_90", "reativacao"]) {
    assert(mensagemWhatsapp(s, { empresa: "X" }), s);
  }
  assertEquals(mensagemWhatsapp("desconhecido", {}), null);
});

Deno.test("destinatários: dono e administradores recebem, cada número uma vez", () => {
  const r = destinosWhatsapp(
    { telefone: "(64) 99216-8514", nome: "Maria" },
    { telefone: "62999990009" },
    [{ telefone: "62 99999-0002", nome: "Gabriel" }, { telefone: "+55 64 99216-8514", nome: "Repetido" }, { telefone: null, nome: "Sem número" }],
  );
  assertEquals(r.map((x) => [x.phone, x.nome, x.papel]), [
    ["5564992168514", "Maria", "dono"],
    ["5562999990002", "Gabriel", "admin"],
    ["5562999990009", null, "financeiro"],
  ]);
});

Deno.test("destinatários: administrador com o mesmo número do financeiro recebe com o próprio nome", () => {
  const r = destinosWhatsapp({ telefone: null }, { telefone: "61981358143" }, [{ telefone: "(61) 98135-8143", nome: "Samanta" }]);
  assertEquals(r.map((x) => [x.nome, x.papel]), [["Samanta", "admin"]]);
});
