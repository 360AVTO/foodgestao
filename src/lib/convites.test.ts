import { describe, expect, it } from "vitest";
import { acoesConvite, conviteVencido, mensagemErroRenovar, situacaoConvite } from "./convites";

const agora = new Date("2026-11-16T12:00:00Z");

describe("convites", () => {
  it("pendente com prazo de 7 dias ultrapassado conta como vencido", () => {
    expect(conviteVencido({ status: "pending", expires_at: "2026-11-16T11:59:00Z" }, agora)).toBe(true);
    expect(situacaoConvite({ status: "pending", expires_at: "2026-11-16T11:59:00Z" }, agora)).toBe("vencido");
  });

  it("pendente dentro do prazo continua pendente", () => {
    expect(situacaoConvite({ status: "pending", expires_at: "2026-11-20T00:00:00Z" }, agora)).toBe("pendente");
  });

  it("status expirado é vencido mesmo sem data", () => {
    expect(situacaoConvite({ status: "expired" }, agora)).toBe("vencido");
  });

  it("vencido oferece renovar e excluir, sem reenviar nem copiar o link velho", () => {
    expect(acoesConvite("vencido")).toEqual({ reenviar: false, copiar: false, cancelar: false, renovar: true, excluir: true });
  });

  it("recusado só pode ser excluído", () => {
    expect(acoesConvite("recusado")).toEqual({ reenviar: false, copiar: false, cancelar: false, renovar: false, excluir: true });
  });

  it("pendente mantém reenviar, copiar e cancelar", () => {
    expect(acoesConvite("pendente")).toEqual({ reenviar: true, copiar: true, cancelar: true, renovar: false, excluir: false });
  });

  it("aceito não tem ações", () => {
    expect(Object.values(acoesConvite("aceito")).some(Boolean)).toBe(false);
  });

  it("traduz o erro de permissão do servidor", () => {
    expect(mensagemErroRenovar("CONVITE_SEM_PERMISSAO")).toMatch(/permissão/);
  });
});
