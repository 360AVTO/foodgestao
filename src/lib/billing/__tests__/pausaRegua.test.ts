import { describe, expect, it } from "vitest";
import { fimDaPausa, MOTIVO_NEGOCIACAO, OPCOES_PAUSA_DIAS, pausaAtiva } from "../pausaRegua";

// 18/11/2026 10:42 em Brasília
const agora = new Date("2026-11-18T13:42:00Z");

describe("pausa da régua por negociação", () => {
  it("oferece pausas de 3, 7 e 15 dias com motivo de negociação", () => {
    expect([...OPCOES_PAUSA_DIAS]).toEqual([3, 7, 15]);
    expect(MOTIVO_NEGOCIACAO).toBe("Em negociação comercial com a equipe");
  });

  it("pausa de 3 dias vale até o fim de 21/11 em Brasília", () => {
    expect(fimDaPausa(3, agora).toISOString()).toBe("2026-11-22T02:59:59.000Z");
  });

  it("pausa de 7 e 15 dias vale até o fim de 25/11 e 03/12", () => {
    expect(fimDaPausa(7, agora).toISOString()).toBe("2026-11-26T02:59:59.000Z");
    expect(fimDaPausa(15, agora).toISOString()).toBe("2026-12-04T02:59:59.000Z");
  });

  it("à noite em Brasília (já outro dia em UTC) conta a partir do dia de Brasília", () => {
    expect(fimDaPausa(3, new Date("2026-11-19T01:30:00Z")).toISOString()).toBe("2026-11-22T02:59:59.000Z");
  });

  it("pausa vencida ou vazia não vale", () => {
    expect(pausaAtiva("2026-11-18T13:00:00Z", agora)).toBe(false);
    expect(pausaAtiva(null, agora)).toBe(false);
    expect(pausaAtiva("2026-11-22T02:59:59Z", agora)).toBe(true);
  });
});
