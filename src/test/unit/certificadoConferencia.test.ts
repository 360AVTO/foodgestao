// @vitest-environment node
import { describe, expect, it } from "vitest";
import { conferirCertificado, sha256DoArquivo } from "@/lib/dp/certificadoConferencia";

const registro = {
  codigo: "ABCD-1234-EF56",
  sha256: "a".repeat(64),
  gerado_em: "2026-11-19T16:00:00Z",
  paginas: 3,
  documento: { titulo: "Contracheque" },
};

describe("conferência de certificado", () => {
  it("é autêntico só com a mesma impressão digital registrada", () => {
    expect(conferirCertificado("A".repeat(64), [registro]).estado).toBe("autentico");
  });

  it("arquivo com um único byte diferente não confere", async () => {
    const original = await sha256DoArquivo(new Blob([new Uint8Array([1, 2, 3])]));
    const alterado = await sha256DoArquivo(new Blob([new Uint8Array([1, 2, 4])]));
    expect(conferirCertificado(alterado, [{ ...registro, sha256: original }]).estado).toBe("nao_encontrado");
    expect(conferirCertificado(original, [{ ...registro, sha256: original }]).estado).toBe("autentico");
  });
});
