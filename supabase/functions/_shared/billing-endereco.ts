// Endereço do pagador para o cliente do Asaas (exigido na emissão da NFS-e).
// Ordem: cadastro da empresa (companies) da conta de cobrança, preferindo o CNPJ do pagador;
// depois a unidade (dp_unidades) com o CNPJ do pagador; por último o endereço oficial
// do CNPJ na Receita (cache `cnpj_cache` / BrasilAPI) — a nota nunca para por cadastro vazio.
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

/** Payload da Receita (lookup-cnpj / BrasilAPI) para o formato de endereço da empresa. */
export function enderecoDaReceita(p: any, cnpj: string): EmpresaEndereco | null {
  if (!p || typeof p !== "object") return null;
  return { cnpj, cep: p.cep ?? null, logradouro: p.logradouro ?? null, numero: p.numero ?? null,
    complemento: p.complemento ?? null, bairro: p.bairro ?? null, cidade: p.municipio ?? null, uf: p.uf ?? null };
}

const CACHE_RECEITA_MS = 30 * 24 * 60 * 60 * 1000;

/** Endereço oficial do CNPJ: cache de até 30 dias; senão consulta a BrasilAPI (8s) e grava no cache. */
async function enderecoReceita(admin: SupabaseClient, cnpj: string): Promise<EnderecoAsaas | null> {
  const { data: cache } = await admin.from("cnpj_cache").select("payload,fetched_at").eq("cnpj", cnpj).maybeSingle();
  const fresco = cache && Date.now() - new Date((cache as any).fetched_at).getTime() < CACHE_RECEITA_MS;
  if (fresco) {
    const e = enderecoAsaas(enderecoDaReceita((cache as any).payload, cnpj));
    if (e) return e;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`BrasilAPI ${r.status}`);
    const d = await r.json();
    const payload = { cnpj: d.cnpj ?? cnpj, razao_social: d.razao_social ?? null, nome_fantasia: d.nome_fantasia ?? null,
      logradouro: d.logradouro ?? null, numero: d.numero ?? null, complemento: d.complemento ?? null, bairro: d.bairro ?? null,
      municipio: d.municipio ?? null, uf: d.uf ?? null, cep: d.cep ?? null };
    await admin.from("cnpj_cache").upsert({ cnpj, payload, fetched_at: new Date().toISOString() }, { onConflict: "cnpj" }).then(() => {}, () => {});
    return enderecoAsaas(enderecoDaReceita(payload, cnpj));
  } catch (e) {
    console.warn("[billing-endereco] Receita indisponível", cnpj, (e as Error).message);
    // cache vencido ainda é melhor que nada
    return cache ? enderecoAsaas(enderecoDaReceita((cache as any).payload, cnpj)) : null;
  } finally { clearTimeout(t); }
}

/** Lê as empresas da conta de cobrança e devolve o endereço para o Asaas. */
export async function enderecoDaConta(admin: SupabaseClient, contaId: string, documentoPagador: string | null | undefined) {
  const { data } = await admin.from("billing_account_companies")
    .select("company_id,companies:company_id(cnpj,cep,logradouro,numero,complemento,bairro,cidade,uf)")
    .eq("billing_account_id", contaId).is("removed_at", null);
  const empresas = (data ?? []).map((r: any) => r.companies).filter(Boolean) as EmpresaEndereco[];
  const doCadastro = escolherEndereco(empresas, documentoPagador);
  if (doCadastro) return doCadastro;
  const doc = digitos(documentoPagador);
  if (doc.length !== 14) return null;
  // Unidade com o mesmo CNPJ do pagador (cadastro de Unidades do Pessoas 360°)
  const ids = (data ?? []).map((r: any) => r.company_id as string).filter(Boolean);
  if (ids.length) {
    const { data: unids } = await admin.from("dp_unidades").select("cnpj,cep,logradouro,numero,complemento,bairro,cidade,uf")
      .in("company_id", ids).eq("ativo", true);
    const daUnidade = ((unids ?? []) as EmpresaEndereco[]).filter((u) => digitos(u.cnpj) === doc).map(enderecoAsaas).find(Boolean);
    if (daUnidade) return daUnidade;
  }
  return await enderecoReceita(admin, doc);
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
