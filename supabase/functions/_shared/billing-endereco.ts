// Endereço do pagador para o cliente do Asaas (exigido na emissão da NFS-e).
// Fonte única: cadastro da empresa (companies) ligada à conta de cobrança,
// preferindo a empresa cujo CNPJ é o documento do pagador.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { asaasFetch, type AsaasEnv } from "./asaas.ts";

export type EmpresaEndereco = {
  cnpj?: string | null; cep?: string | null; logradouro?: string | null; numero?: string | null;
  complemento?: string | null; bairro?: string | null; cidade?: string | null; uf?: string | null;
};
export type EnderecoAsaas = {
  postalCode: string; address: string; addressNumber: string; province: string; complement?: string;
};

const digitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const texto = (s: string | null | undefined) => (s ?? "").trim();

/** Converte o endereço da empresa para os campos do cliente no Asaas; null se incompleto. */
export function enderecoAsaas(e: EmpresaEndereco | null | undefined): EnderecoAsaas | null {
  if (!e) return null;
  const cep = digitos(e.cep);
  const rua = texto(e.logradouro), bairro = texto(e.bairro);
  if (cep.length !== 8 || !rua || !bairro) return null;
  const out: EnderecoAsaas = { postalCode: cep, address: rua, addressNumber: texto(e.numero) || "S/N", province: bairro };
  const comp = texto(e.complemento);
  if (comp) out.complement = comp;
  return out;
}

/** Escolhe o endereço: empresa com o CNPJ do pagador primeiro; senão a primeira com endereço completo. */
export function escolherEndereco(empresas: EmpresaEndereco[], documentoPagador: string | null | undefined): EnderecoAsaas | null {
  const doc = digitos(documentoPagador);
  const doPagador = doc ? empresas.find((e) => digitos(e.cnpj) === doc) : undefined;
  const preferido = enderecoAsaas(doPagador);
  if (preferido) return preferido;
  for (const e of empresas) {
    const end = enderecoAsaas(e);
    if (end) return end;
  }
  return null;
}

/** Lê as empresas da conta de cobrança e devolve o endereço para o Asaas. */
export async function enderecoDaConta(admin: SupabaseClient, contaId: string, documentoPagador: string | null | undefined) {
  const { data } = await admin.from("billing_account_companies")
    .select("companies:company_id(cnpj,cep,logradouro,numero,complemento,bairro,cidade,uf)")
    .eq("billing_account_id", contaId);
  const empresas = (data ?? []).map((r: any) => r.companies).filter(Boolean) as EmpresaEndereco[];
  return escolherEndereco(empresas, documentoPagador);
}

/** Grava o endereço no cliente do Asaas. Retorna false quando o cadastro da empresa está incompleto. */
export async function sincronizarEnderecoCliente(
  admin: SupabaseClient, contaId: string, customerId: string, documentoPagador: string | null | undefined, env: AsaasEnv,
): Promise<boolean> {
  const end = await enderecoDaConta(admin, contaId, documentoPagador);
  if (!end) return false;
  await asaasFetch(`/customers/${customerId}`, { method: "POST", body: JSON.stringify(end) }, env);
  return true;
}
