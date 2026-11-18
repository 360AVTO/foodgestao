import { assertEquals } from "jsr:@std/assert@1";
import { enderecoAsaas, enderecoDaReceita, escolherEndereco, telefonesAsaas } from "./billing-endereco.ts";

const aveto = { cnpj: "12.345.678/0001-90", cep: "74367-633", logradouro: "Avenida Ravena", numero: "201", complemento: "Ap. 1204", bairro: "Residencial Eldorado", cidade: "GOIÂNIA", uf: "GO" };

Deno.test("endereço completo vira campos do cliente no Asaas com CEP só dígitos", () => {
  assertEquals(enderecoAsaas(aveto), { postalCode: "74367633", address: "Avenida Ravena", addressNumber: "201", province: "Residencial Eldorado", complement: "Ap. 1204" });
});

Deno.test("sem número usa S/N; sem CEP válido, rua ou bairro não envia", () => {
  assertEquals(enderecoAsaas({ ...aveto, numero: null })?.addressNumber, "S/N");
  assertEquals(enderecoAsaas({ ...aveto, cep: "7436" }), null);
  assertEquals(enderecoAsaas({ ...aveto, logradouro: " " }), null);
  assertEquals(enderecoAsaas({ ...aveto, bairro: null }), null);
});

Deno.test("prefere a empresa com o CNPJ do pagador; senão a primeira completa", () => {
  const outra = { ...aveto, cnpj: "99999999000199", cep: "01001000", logradouro: "Praça da Sé" };
  assertEquals(escolherEndereco([outra, aveto], "12345678000190")?.postalCode, "74367633");
  assertEquals(escolherEndereco([{ cnpj: "12345678000190" }, outra], "12345678000190")?.postalCode, "01001000");
  assertEquals(escolherEndereco([{ cnpj: "1" }], "1"), null);
});

Deno.test("endereço oficial da Receita completa o cliente quando o cadastro está vazio", () => {
  const receita = { cep: "74932-260", logradouro: "9 A", numero: "S/N", complemento: "QUADRA10 LOTE 03", bairro: "SETOR GARAVELO", municipio: "APARECIDA DE GOIANIA", uf: "GO" };
  assertEquals(enderecoAsaas(enderecoDaReceita(receita, "06002178000158")), { postalCode: "74932260", address: "9 A", addressNumber: "S/N", province: "SETOR GARAVELO", complement: "QUADRA10 LOTE 03" });
  assertEquals(enderecoDaReceita(null, "06002178000158"), null);
  assertEquals(enderecoAsaas(enderecoDaReceita({ logradouro: "9 A" }, "06002178000158")), null);
});

Deno.test("telefones: WhatsApp/celular vai em mobilePhone, fixo em phone, sem o 55", () => {
  assertEquals(telefonesAsaas({ whatsapp: "+55 (62) 99236-5959", phone: "(62) 3333-4444" }), { mobilePhone: "62992365959", phone: "6233334444" });
  assertEquals(telefonesAsaas({ phone: "62992365959" }), { mobilePhone: "62992365959" });
  assertEquals(telefonesAsaas({ phone: "123", whatsapp: null }), {});
});
