import { describe, expect, it } from "vitest";
import { formatarWhatsapp, validarWhatsappCobranca } from "../whatsappCobranca";

describe("WhatsApp do financeiro", () => {
  it("grava com 55 quando informado com DDD", () => {
    expect(validarWhatsappCobranca("(62) 99999-0001")).toEqual({ ok: true, valor: "5562999990001" });
    expect(validarWhatsappCobranca("+55 62 3333-0001")).toEqual({ ok: true, valor: "556233330001" });
  });
  it("campo vazio remove o número", () => {
    expect(validarWhatsappCobranca("  ")).toEqual({ ok: true, valor: null });
  });
  it("recusa número sem DDD ou com DDD inválido", () => {
    expect(validarWhatsappCobranca("99999-0001").ok).toBe(false);
    expect(validarWhatsappCobranca("(20) 99999-0001").ok).toBe(false);
  });
  it("mostra o número formatado", () => {
    expect(formatarWhatsapp("5562999990001")).toBe("(62) 99999-0001");
  });
});
