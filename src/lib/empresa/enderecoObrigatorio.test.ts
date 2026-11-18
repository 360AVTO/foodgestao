import { describe, expect, it } from "vitest";
import { enderecoCompleto, errosEndereco, ufDoCep } from "./enderecoObrigatorio";

const garavelo = { cep: "74932-260", logradouro: "Rua 9 A", numero: "S/N", bairro: "Setor Garavelo", cidade: "Aparecida de Goiânia", uf: "GO" };

describe("endereço obrigatório de empresa e unidade", () => {
  it("endereço completo passa", () => {
    expect(errosEndereco(garavelo)).toEqual({});
    expect(enderecoCompleto(garavelo)).toBe(true);
  });

  it("exige CEP, rua, número, bairro, cidade e UF", () => {
    const e = errosEndereco({});
    expect(Object.keys(e).sort()).toEqual(["bairro", "cep", "cidade", "logradouro", "numero", "uf"]);
  });

  it("CEP precisa de 8 números", () => {
    expect(errosEndereco({ ...garavelo, cep: "7493" }).cep).toBeTruthy();
  });

  it("UF tem de combinar com o CEP (unidade de Goiás gravada como AM)", () => {
    expect(errosEndereco({ ...garavelo, uf: "AM" }).uf).toContain("GO");
  });

  it("faixas de CEP: Goiás, DF, Amazonas e São Paulo", () => {
    expect(ufDoCep("74932-260")).toBe("GO");
    expect(ufDoCep("72800-000")).toBe("GO");
    expect(ufDoCep("70040-010")).toBe("DF");
    expect(ufDoCep("69005-000")).toBe("AM");
    expect(ufDoCep("01001-000")).toBe("SP");
    expect(ufDoCep("123")).toBeNull();
  });
});
