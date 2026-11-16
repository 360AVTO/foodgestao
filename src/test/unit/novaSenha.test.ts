import { describe, it, expect } from "vitest";
import { motivoSenhaPendente } from "@/lib/security/novaSenha";

// Senhas fictícias, nunca de pessoas reais.
const FORTE = "Trilha#Verde42x";

describe("motivo didático da senha nova", () => {
  it("pede para criar a senha quando o campo está vazio", () => {
    expect(motivoSenhaPendente("", "")).toBe("Crie sua senha no primeiro campo.");
  });

  it("lista todos os requisitos que faltam, na ordem do checklist", () => {
    expect(motivoSenhaPendente("abc", "")).toBe(
      "Ainda falta na senha: 8 caracteres, 1 letra maiúscula, 1 número e 1 símbolo (@ # $ * ! ?).",
    );
  });

  it("aponta só o símbolo quando é o único requisito faltando", () => {
    expect(motivoSenhaPendente("TrilhaVerde42x", "TrilhaVerde42x")).toBe(
      "Ainda falta na senha: 1 símbolo (@ # $ * ! ?).",
    );
  });

  it("avisa quando a senha usa o nome da pessoa", () => {
    expect(motivoSenhaPendente("Karolina@2026", "Karolina@2026", { nome: "Karolina Souza" })).toBe(
      "Não use seu nome, e-mail ou CPF na senha.",
    );
  });

  it("pede a confirmação e depois avisa se estiver diferente", () => {
    expect(motivoSenhaPendente(FORTE, "")).toBe("Repita a mesma senha no campo de confirmação.");
    expect(motivoSenhaPendente(FORTE, "Trilha#Verde42")).toBe("A confirmação está diferente da senha digitada.");
  });

  it("libera quando a senha atende à regra e a confirmação confere", () => {
    expect(motivoSenhaPendente(FORTE, FORTE)).toBeNull();
  });
});
