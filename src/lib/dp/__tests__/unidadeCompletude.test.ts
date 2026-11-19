import { describe, expect, it } from "vitest";
import { abaParaCompletar, pendenciasUnidade } from "../unidade-completude";

const completa = {
  cnpj: "12345678000190", cep: "75200-000", logradouro: "Rua A", numero: "10", bairro: "Centro",
  cidade: "Aparecida de Goiânia", uf: "GO", telefone: "64999990000", tem_adiantamento: false,
  pagamento_salario_tipo: "quinto_dia_util",
};
const nacionais = [
  { tipo: "anual" as const, dia: 1, mes: 1, categoria: "nacional" as const, ativo: true },
  { tipo: "anual" as const, dia: 21, mes: 4, categoria: "nacional" as const, ativo: true },
];
const municipal = { tipo: "anual" as const, dia: 11, mes: 5, categoria: "municipal" as const, ativo: true };
const chaves = (p: ReturnType<typeof pendenciasUnidade>) => p.map((x) => x.chave);

describe("cadastro incompleto da unidade", () => {
  it("unidade completa não sinaliza nada", () => {
    expect(pendenciasUnidade(completa, { feriados: [...nacionais, municipal], funcionamentoDefinido: true })).toEqual([]);
  });
  it("aponta as partes do endereço que faltam", () => {
    const p = pendenciasUnidade({ ...completa, numero: "", cep: null });
    expect(p).toEqual([{ chave: "endereco", rotulo: "Endereço", detalhe: "falta número, CEP", aba: "dados" }]);
  });
  it("sem dia de pagamento, sem telefone e sem dia do adiantamento", () => {
    const p = pendenciasUnidade({ ...completa, telefone: "", pagamento_salario_tipo: null, tem_adiantamento: true });
    expect(chaves(p)).toEqual(["telefone", "pagamento", "adiantamento"]);
  });
  it("dia fixo sem o dia conta como pagamento em falta", () => {
    expect(chaves(pendenciasUnidade({ ...completa, pagamento_salario_tipo: "dia_fixo" }))).toEqual(["pagamento"]);
  });
  it("unidade sem feriados ativos é sinalizada", () => {
    expect(chaves(pendenciasUnidade(completa, { feriados: [] }))).toEqual(["feriados"]);
  });
  it("só feriados nacionais cobra os municipais e estaduais, com a cidade", () => {
    const p = pendenciasUnidade(completa, { feriados: nacionais, feriadosCienteEm: null });
    expect(chaves(p)).toEqual(["feriados_locais"]);
    expect(p[0].detalhe).toContain("Aparecida de Goiânia - GO");
    expect(p[0].aba).toBe("feriados");
  });
  it("confirmar que não há feriados locais encerra a pendência", () => {
    expect(pendenciasUnidade(completa, { feriados: nacionais, feriadosCienteEm: "2026-11-19T12:00:00Z" })).toEqual([]);
  });
  it("feriados ainda carregando não geram alerta", () => {
    expect(pendenciasUnidade(completa, {})).toEqual([]);
  });
  it("mais de 20 pessoas sem ponto e sem justificativa cobra o Art. 74", () => {
    expect(chaves(pendenciasUnidade({ ...completa, possui_relogio_ponto: false }, { pessoasPrevistas: 21 }))).toEqual(["ponto"]);
  });
  it("20 pessoas, ponto ligado ou justificativa registrada não cobram o ponto", () => {
    expect(pendenciasUnidade({ ...completa, possui_relogio_ponto: false }, { pessoasPrevistas: 20 })).toEqual([]);
    expect(pendenciasUnidade({ ...completa, possui_relogio_ponto: true }, { pessoasPrevistas: 30 })).toEqual([]);
    expect(
      pendenciasUnidade(
        { ...completa, possui_relogio_ponto: false, relogio_ponto_dispensa_justificativa: "Acordo coletivo vigente" },
        { pessoasPrevistas: 30 },
      ),
    ).toEqual([]);
  });
  it("funcionamento não definido é só opcional", () => {
    const p = pendenciasUnidade(completa, { funcionamentoDefinido: false });
    expect(p).toHaveLength(1);
    expect(p[0].opcional).toBe(true);
  });
  it("completar abre a aba da primeira pendência que importa", () => {
    expect(abaParaCompletar(pendenciasUnidade(completa, { feriados: nacionais, funcionamentoDefinido: false }))).toBe("feriados");
    expect(abaParaCompletar(pendenciasUnidade({ ...completa, telefone: "" }, { feriados: nacionais }))).toBe("dados");
    expect(abaParaCompletar(pendenciasUnidade(completa, { funcionamentoDefinido: false }))).toBe("funcionamento");
  });
});
