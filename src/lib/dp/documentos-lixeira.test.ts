import { describe, expect, it } from "vitest";
import {
  LIXEIRA_DIAS, diasRestantes, podeRestaurar, rotuloPrazo, motivoExibivel,
  competenciaLixeira, erroRestauracao, MOTIVO_PADRAO_EXCLUSAO,
} from "./documentos-lixeira";
import { ehRegraNegada } from "./regraAviso";

const excluidoEm = "2026-11-15T17:21:13Z";
const depois = (horas: number) => new Date(new Date(excluidoEm).getTime() + horas * 3600_000);

describe("Lixeira de documentos", () => {
  it("guarda por 7 dias", () => {
    expect(LIXEIRA_DIAS).toBe(7);
  });

  it("permite restaurar até completar 7 dias da exclusão", () => {
    expect(podeRestaurar(excluidoEm, depois(0))).toBe(true);
    expect(podeRestaurar(excluidoEm, depois(7 * 24 - 1))).toBe(true);
    expect(podeRestaurar(excluidoEm, depois(7 * 24))).toBe(false);
  });

  it("conta os dias restantes", () => {
    expect(diasRestantes(excluidoEm, depois(0))).toBe(7);
    expect(diasRestantes(excluidoEm, depois(25))).toBe(6);
    expect(diasRestantes(excluidoEm, depois(7 * 24 + 1))).toBe(0);
    expect(rotuloPrazo(excluidoEm, depois(25))).toBe("6 dias restantes");
    expect(rotuloPrazo(excluidoEm, depois(6 * 24 + 1))).toBe("23 horas restantes");
    expect(rotuloPrazo(excluidoEm, depois(7 * 24))).toBe("Prazo encerrado");
  });

  it("não exibe o motivo automático, só o escrito pela pessoa", () => {
    expect(motivoExibivel(MOTIVO_PADRAO_EXCLUSAO)).toBeNull();
    expect(motivoExibivel("  ")).toBeNull();
    expect(motivoExibivel("Competência errada")).toBe("Competência errada");
  });

  it("mostra a competência como MM/AAAA", () => {
    expect(competenciaLixeira("2026-10-01")).toBe("10/2026");
    expect(competenciaLixeira(null)).toBe("—");
  });

  it("recusa restaurar quando já existe documento ativo da mesma competência", () => {
    const e = erroRestauracao({ message: "DOC_LIXEIRA_VERSAO_ATIVA" });
    expect(ehRegraNegada(e)).toBe(true);
    expect(e.message).toContain("Já existe outro documento ativo");
  });

  it("prazo vencido é aviso de regra, falha técnica continua erro", () => {
    expect(ehRegraNegada(erroRestauracao({ message: "DOC_LIXEIRA_PRAZO_VENCIDO" }))).toBe(true);
    expect(ehRegraNegada(erroRestauracao({ message: "connection reset" }))).toBe(false);
  });
});
