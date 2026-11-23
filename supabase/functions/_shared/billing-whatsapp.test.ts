import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  destinosWhatsapp, ESTAGIOS_WHATSAPP, mensagemWhatsapp, nomeSaudacao, proximoEnvioAvulso, proximoEnvioWhatsapp, validadeWhatsapp,
} from "./billing-whatsapp.ts";

// Horários em Brasília (UTC-3)
const brt = (iso: string) => new Date(`${iso}-03:00`);


Deno.test("antes das 9h30 de um dia útil espera a janela da manhã", () => {
  // 18/11/2026 é quarta-feira
  assertEquals(proximoEnvioWhatsapp("d_0", brt("2026-11-18T08:00:00")).toISOString(), brt("2026-11-18T09:30:00").toISOString());
});

Deno.test("dentro da janela envia na hora", () => {
  const agora = brt("2026-11-18T10:15:00");
  assertEquals(proximoEnvioWhatsapp("wa_pos_fim_1", agora).getTime(), agora.getTime());
});

Deno.test("entre 11h e 15h espera a janela da tarde", () => {
  assertEquals(proximoEnvioWhatsapp("trial_d5", brt("2026-11-18T12:00:00")).toISOString(), brt("2026-11-18T15:00:00").toISOString());
});

Deno.test("sábado e domingo ficam para segunda às 9h30", () => {
  // 21/11/2026 é sábado
  assertEquals(proximoEnvioWhatsapp("trial_d5", brt("2026-11-21T08:00:00")).toISOString(), brt("2026-11-23T09:30:00").toISOString());
});

Deno.test("depois das 16h30 de sexta vai para segunda", () => {
  assertEquals(proximoEnvioWhatsapp("trial_d5", brt("2026-11-27T17:00:00")).toISOString(), brt("2026-11-30T09:30:00").toISOString());
});

Deno.test("feriado nacional é silêncio: 20/11/2026 (sexta) passa para segunda 23/11", () => {
  assertEquals(proximoEnvioWhatsapp("trial_d5", brt("2026-11-20T08:00:00")).toISOString(), brt("2026-11-23T09:30:00").toISOString());
});

Deno.test("1º toque só de manhã; 2º toque só à tarde", () => {
  assertEquals(proximoEnvioWhatsapp("wa_mensalidade_lembrete", brt("2026-11-18T12:00:00")).toISOString(), brt("2026-11-19T09:30:00").toISOString());
  assertEquals(proximoEnvioWhatsapp("wa_pos_fim_1", brt("2026-11-18T15:30:00")).toISOString(), brt("2026-11-19T09:30:00").toISOString());
  assertEquals(proximoEnvioWhatsapp("wa_mensalidade_em_aberto", brt("2026-11-18T10:00:00")).toISOString(), brt("2026-11-18T15:00:00").toISOString());
  assertEquals(proximoEnvioWhatsapp("wa_pos_fim_2", brt("2026-11-18T10:00:00")).toISOString(), brt("2026-11-18T15:00:00").toISOString());
  assertEquals(proximoEnvioWhatsapp("wa_cartao_nao_confirmado", brt("2026-11-18T10:00:00")).toISOString(), brt("2026-11-18T15:00:00").toISOString());
});

Deno.test("confirmação de pagamento sai todo dia entre 8h e 20h", () => {
  const sabado = brt("2026-11-21T10:00:00");
  assertEquals(proximoEnvioWhatsapp("reativacao", sabado).getTime(), sabado.getTime());
  assertEquals(proximoEnvioWhatsapp("reativacao", brt("2026-11-21T22:00:00")).toISOString(), brt("2026-11-22T08:00:00").toISOString());
});

Deno.test("aviso com data do dia vale só até o fim do dia em Brasília", () => {
  assertEquals(validadeWhatsapp("d_0", brt("2026-11-21T08:00:00")).toISOString(), brt("2026-11-21T23:59:59.999").toISOString());
});

Deno.test("oferta do plano pode esperar até 3 dias", () => {
  const criado = brt("2026-11-21T08:00:00");
  assertEquals(validadeWhatsapp("oferta_plano", criado).getTime() - criado.getTime(), 3 * 24 * 3600 * 1000);
});

Deno.test("destinatários: dono e financeiro, sem repetir o mesmo número", () => {
  assertEquals(destinosWhatsapp({ telefone: "(62) 99999-0001", nome: "Rafael" }, { telefone: "62999990002" }).map((x) => [x.phone, x.papel]),
    [["5562999990001", "dono"], ["5562999990002", "financeiro"]]);
  assertEquals(destinosWhatsapp({ telefone: "62999990001" }, { telefone: "+55 62 99999-0001" }).length, 1);
  assertEquals(destinosWhatsapp({ telefone: "123" }, { telefone: null }).length, 0);
});

Deno.test("só os toques combinados têm WhatsApp; o resto da régua segue por e-mail", () => {
  for (const s of ESTAGIOS_WHATSAPP) assert(mensagemWhatsapp(s, { empresa: "X" }), s);
  for (const s of ["d_menos_3", "d_0", "d_mais_1", "d_mais_5", "d_mais_8", "d_mais_10", "d_mais_11", "d_mais_20",
    "d_mais_28", "d_mais_31", "d_mais_60", "d_mais_80", "d_mais_90", "trial_pos_1", "trial_pos_4", "trial_pos_8",
    "grace_d_menos_1", "desconhecido"]) {
    assertEquals(mensagemWhatsapp(s, { empresa: "X" }), null, s);
  }
});

const linhas = (t: string) => t.split("\n");
Deno.test("mensagens curtas: respiro depois da saudação e pergunta no final", () => {
  const d = { nome: "Maria", empresa: "RANCHO 330", link: "https://x/pagar", linkPlanos: "https://x/planos" };
  for (const s of ["wa_mensalidade_lembrete", "wa_mensalidade_em_aberto", "wa_cartao_nao_confirmado", "wa_pos_fim_1", "wa_pos_fim_2"]) {
    const t = mensagemWhatsapp(s, d)!;
    assert(/^(Olá|Oi), Maria!/.test(t), s);
    assertEquals(linhas(t)[1], "", s);
    assert(t.trim().endsWith("?"), s);
    assert(t.includes("*RANCHO 330*"), s);
    assert(t.length < 400, `${s}: ${t.length}`);
  }
});

Deno.test("em aberto: pergunta muda conforme boleto ou Pix e reforça que o acesso continua", () => {
  const boleto = mensagemWhatsapp("wa_mensalidade_em_aberto", { empresa: "X", forma: "boleto" })!;
  const pix = mensagemWhatsapp("wa_mensalidade_em_aberto", { empresa: "X", forma: "pix" })!;
  assert(boleto.includes("2ª via") && boleto.includes("100% liberado"));
  assert(pix.includes("Pix") && !pix.includes("2ª via"));
});

Deno.test("pós-carência fala em reativar; pós-teste em manter o acesso", () => {
  assert(mensagemWhatsapp("wa_pos_fim_1", { empresa: "X", encerramento: "carencia" })!.includes("reativar"));
  assert(mensagemWhatsapp("wa_pos_fim_1", { empresa: "X", encerramento: "teste" })!.includes("manter o acesso"));
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

Deno.test("proprietário só recebe com a opção ligada no cadastro da empresa", () => {
  const prop = { telefone: "(64) 98136-7653", nome: "Rafael" };
  const desligado = destinosWhatsapp({ telefone: "64992168514", nome: "Maria" }, { telefone: null }, [], { ...prop, recebe: false });
  assertEquals(desligado.map((x) => x.papel), ["dono"]);
  const semOpcao = destinosWhatsapp({ telefone: "64992168514" }, { telefone: null }, [], prop);
  assertEquals(semOpcao.map((x) => x.papel), ["dono"]);
  const ligado = destinosWhatsapp({ telefone: "64992168514", nome: "Maria" }, { telefone: null }, [], { ...prop, recebe: true });
  assertEquals(ligado.map((x) => [x.phone, x.nome, x.papel]), [
    ["5564992168514", "Maria", "dono"],
    ["5564981367653", "Rafael", "proprietario"],
  ]);
});

Deno.test("financeiro recebe com o próprio nome e proprietário com o mesmo número não duplica", () => {
  const r = destinosWhatsapp({ telefone: null }, { telefone: "64992168514", nome: "Maria" }, [],
    { telefone: "+55 64 99216-8514", nome: "Rafael", recebe: true });
  assertEquals(r.map((x) => [x.nome, x.papel]), [["Rafael", "proprietario"]]);
  const so = destinosWhatsapp({ telefone: null }, { telefone: "64992168514", nome: "Maria" });
  assertEquals(so.map((x) => [x.nome, x.papel]), [["Maria", "financeiro"]]);
});

Deno.test("envio avulso sai às 17h50 (fora da janela comercial), mas não depois das 20h", () => {
  const tarde = brt("2026-11-18T17:50:00");
  assertEquals(proximoEnvioAvulso(tarde).getTime(), tarde.getTime());
  assertEquals(proximoEnvioAvulso(brt("2026-11-18T21:00:00")).toISOString(), brt("2026-11-19T08:00:00").toISOString());
});

Deno.test("saudação usa o primeiro nome só com a inicial maiúscula", () => {
  assertEquals(nomeSaudacao("SAMANTA SOUZA"), "Samanta");
  assertEquals(nomeSaudacao("silvio"), "Silvio");
  assertEquals(nomeSaudacao("ÉRICA"), "Érica");
  assertEquals(nomeSaudacao(null), "");
  assert(mensagemWhatsapp("wa_pos_fim_2", { empresa: "X", nome: "SAMANTA" })!.startsWith("Oi, Samanta!"));
  assert(mensagemWhatsapp("wa_pos_fim_1", { empresa: "X", nome: "SAMANTA" })!.startsWith("Olá, Samanta!"));
});
