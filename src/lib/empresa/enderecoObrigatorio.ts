/**
 * Endereço obrigatório de empresas e unidades.
 *
 * O endereço vai para o cadastro do pagador no Asaas e para a nota fiscal —
 * sem CEP, rua, número, bairro, cidade e UF a nota é recusada. Por isso todo
 * cadastro de empresa e de unidade exige o endereço completo e confere se a
 * UF combina com o CEP (o CEP de cada estado segue faixas fixas dos Correios).
 */
import { SEM_NUMERO, UFS, cepDigitos } from "@/lib/endereco";

export const CAMPOS_ENDERECO_OBRIGATORIOS = ["cep", "logradouro", "numero", "bairro", "cidade", "uf"];

export interface EnderecoParaValidar {
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
}

/** Faixas de CEP por estado (cinco primeiros dígitos, Correios). */
const FAIXAS_CEP: [number, number, string][] = [
  [1000, 19999, "SP"], [20000, 28999, "RJ"], [29000, 29999, "ES"], [30000, 39999, "MG"],
  [40000, 48999, "BA"], [49000, 49999, "SE"], [50000, 56999, "PE"], [57000, 57999, "AL"],
  [58000, 58999, "PB"], [59000, 59999, "RN"], [60000, 63999, "CE"], [64000, 64999, "PI"],
  [65000, 65999, "MA"], [66000, 68899, "PA"], [68900, 68999, "AP"], [69000, 69299, "AM"],
  [69300, 69399, "RR"], [69400, 69899, "AM"], [69900, 69999, "AC"], [70000, 72799, "DF"],
  [72800, 72999, "GO"], [73000, 73699, "DF"], [73700, 76799, "GO"], [76800, 76999, "RO"],
  [77000, 77999, "TO"], [78000, 78899, "MT"], [79000, 79999, "MS"], [80000, 87999, "PR"],
  [88000, 89999, "SC"], [90000, 99999, "RS"],
];

/** UF esperada para o CEP; null quando o CEP está incompleto. */
export function ufDoCep(cep: string | null | undefined): string | null {
  const d = cepDigitos(cep);
  if (d.length !== 8) return null;
  const prefixo = Number(d.slice(0, 5));
  return FAIXAS_CEP.find(([ini, fim]) => prefixo >= ini && prefixo <= fim)?.[2] ?? null;
}

const vazio = (v: string | null | undefined) => !String(v ?? "").trim();

/** Erros por campo; objeto vazio quando o endereço está completo e coerente. */
export function errosEndereco(e: EnderecoParaValidar): Record<string, string> {
  const erros: Record<string, string> = {};
  const cep = cepDigitos(e.cep);
  if (!cep) erros.cep = "Informe o CEP.";
  else if (cep.length !== 8) erros.cep = "O CEP tem 8 números.";
  if (vazio(e.logradouro)) erros.logradouro = "Informe a rua ou avenida.";
  if (vazio(e.numero)) erros.numero = `Informe o número ou marque "Sem número".`;
  if (vazio(e.bairro)) erros.bairro = "Informe o bairro.";
  if (vazio(e.cidade)) erros.cidade = "Informe a cidade.";
  const uf = String(e.uf ?? "").trim().toUpperCase();
  if (!uf) erros.uf = "Escolha o estado.";
  else if (!(UFS as readonly string[]).includes(uf)) erros.uf = "Estado inválido.";
  else {
    const esperada = ufDoCep(e.cep);
    if (esperada && esperada !== uf && !erros.cep) erros.uf = `Este CEP é de ${esperada}. Confira o estado ou o CEP.`;
  }
  return erros;
}

export function enderecoCompleto(e: EnderecoParaValidar | null | undefined): boolean {
  return !!e && Object.keys(errosEndereco(e)).length === 0;
}

export { SEM_NUMERO };
