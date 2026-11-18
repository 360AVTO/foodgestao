// Leituras de servidor da régua por WhatsApp: interruptor geral e números do titular,
// do proprietário (só com a opção ligada no cadastro da empresa), dos administradores
// ativos e do responsável financeiro da conta de cobrança.
import { destinosWhatsapp, type DestinoWa } from "./billing-whatsapp.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

export async function whatsappReguaAtivo(admin: Admin): Promise<boolean> {
  const { data, error } = await admin.from("billing_regua_config").select("whatsapp_ativo")
    .eq("id", true).maybeSingle();
  if (error) {
    console.error("[billing-whatsapp] config:", error.code);
    return false;
  }
  return data?.whatsapp_ativo === true;
}

export async function destinosWhatsappCobranca(
  admin: Admin,
  companyId: string,
  ownerUserId: string | null,
): Promise<DestinoWa[]> {
  let donoTel: string | null = null;
  let donoNome: string | null = null;
  if (ownerUserId) {
    const { data } = await admin.from("profiles").select("phone, full_name")
      .eq("user_id", ownerUserId).maybeSingle();
    donoTel = (data?.phone as string | null) ?? null;
    donoNome = ((data?.full_name as string | null) ?? "").trim().split(/\s+/)[0] || null;
  }
  // Demais gestores: donos/administradores ativos da empresa (mesma regra do e-mail)
  const gestores: Array<{ telefone: string | null; nome: string | null }> = [];
  const { data: membros } = await admin.from("company_members").select("user_id, role, situacao")
    .eq("company_id", companyId).in("role", ["owner", "admin"]);
  const ids = (membros ?? [])
    .filter((m: { user_id: string; situacao: string | null }) => m.situacao === "ativo" && m.user_id !== ownerUserId)
    .map((m: { user_id: string }) => m.user_id);
  if (ids.length) {
    const { data: perfis } = await admin.from("profiles").select("user_id, phone, full_name").in("user_id", ids);
    for (const pr of perfis ?? []) {
      gestores.push({
        telefone: (pr.phone as string | null) ?? null,
        nome: ((pr.full_name as string | null) ?? "").trim().split(/\s+/)[0] || null,
      });
    }
  }
  const primeiro = (v: unknown) => String(v ?? "").trim().split(/\s+/)[0] || null;
  const { data: emp } = await admin.from("companies")
    .select("proprietario_nome, proprietario_whatsapp, proprietario_recebe_cobranca, financeiro_nome")
    .eq("id", companyId).maybeSingle();
  let finTel: string | null = null;
  const { data: vinc } = await admin.from("billing_account_companies").select("billing_account_id")
    .eq("company_id", companyId).is("removed_at", null).limit(1).maybeSingle();
  if (vinc?.billing_account_id) {
    const { data: conta } = await admin.from("billing_accounts").select("whatsapp_cobranca")
      .eq("id", vinc.billing_account_id).maybeSingle();
    finTel = (conta?.whatsapp_cobranca as string | null) ?? null;
  }
  return destinosWhatsapp(
    { telefone: donoTel, nome: donoNome },
    { telefone: finTel, nome: primeiro(emp?.financeiro_nome) },
    gestores,
    {
      telefone: (emp?.proprietario_whatsapp as string | null) ?? null,
      nome: primeiro(emp?.proprietario_nome),
      recebe: emp?.proprietario_recebe_cobranca === true,
    },
  );
}
