// Notas fiscais (NFS-e) pelo Asaas — só super admin.
// listar: últimas solicitações; reprocessar: reenvia UMA solicitação recusada
// (mesma fatura já paga, nunca cria cobrança; confere nota existente antes).
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";
import { parseAsaasEnv } from "../_shared/asaas.ts";
import { solicitarNfse } from "../_shared/billing-v2-ciclo.ts";

const Body = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("listar") }),
  z.object({ acao: z.literal("reprocessar"), solicitacao_id: z.string().uuid() }),
  z.object({ acao: z.literal("salvar_config"),
    codigo_servico: z.string().trim().regex(/^\d{2}\.\d{2}\.\d{2}(\.\d{3})?$/, "Código no formato 01.05.01 (ou 01.05.01.001)."),
    nome_servico: z.string().trim().min(5).max(200),
    descricao: z.string().trim().min(5).max(250),
    iss: z.number().min(0).max(5) }),
]);
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u.user) return json({ error: "Sessão expirada. Entre novamente." }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: isSuper } = await admin.rpc("is_super_admin", { _user_id: u.user.id });
    if (!isSuper) return json({ error: "Apenas o super admin pode gerir notas fiscais." }, 403);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, 400);
    const b = parsed.data;

    if (b.acao === "salvar_config") {
      const value = { codigo_servico: b.codigo_servico, nome_servico: b.nome_servico, descricao: b.descricao, iss: b.iss };
      const { error } = await admin.from("system_parameters").upsert({ key: "nfse_config", value, updated_by: u.user.id }, { onConflict: "key" });
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, config: value });
    }

    if (b.acao === "listar") {
      const { data: cfg } = await admin.from("system_parameters").select("value,updated_at").eq("key", "nfse_config").maybeSingle();
      const { data, error } = await admin.from("billing_v2_nfse_solicitacoes")
        .select("id,status,valor_cents,asaas_invoice_id,resposta,created_at,invoices:invoice_id(billing_account_id,billing_accounts:billing_account_id(nome))")
        .eq("asaas_env", "production").order("created_at", { ascending: false }).limit(20);
      if (error) return json({ error: error.message }, 500);
      return json({ config: (cfg as any)?.value ?? null, config_atualizada_em: (cfg as any)?.updated_at ?? null, itens: (data ?? []).map((r: any) => ({
        id: r.id, status: r.status, valor_cents: r.valor_cents, asaas_invoice_id: r.asaas_invoice_id, created_at: r.created_at,
        conta: r.invoices?.billing_accounts?.nome ?? null, erro: r.resposta?.erro ?? null,
        tentativas: Array.isArray(r.resposta?.tentativas_anteriores) ? r.resposta.tentativas_anteriores.length + 1 : 1,
      })) });
    }

    const { data: sol } = await admin.from("billing_v2_nfse_solicitacoes").select("id,status,invoice_id").eq("id", b.solicitacao_id).maybeSingle();
    if (!sol) return json({ error: "Solicitação não encontrada." }, 404);
    if (sol.status !== "recusada_asaas") return json({ error: "Só notas recusadas podem ser reenviadas." }, 409);
    const { data: inv } = await admin.from("invoices").select("*").eq("id", sol.invoice_id).maybeSingle();
    if (!inv) return json({ error: "Fatura não encontrada." }, 404);
    if ((inv as any).status !== "paid") return json({ error: "A fatura não está paga; a nota só sai após o pagamento." }, 409);
    const r = await solicitarNfse(admin as any, inv, parseAsaasEnv((inv as any).asaas_env), { reprocessar: true });
    await admin.from("audit_logs").insert({ user_id: u.user.id, action: "nfse_reprocessada", entity_type: "billing_v2_nfse_solicitacoes", entity_id: sol.id, details: { status: r.status } }).then(() => {}, () => {});
    return json({ ok: r.status !== "recusada_asaas", status: r.status, erro: (r as any).resposta?.erro ?? null, asaas_invoice_id: (r as any).asaas_invoice_id ?? null });
  } catch (e) {
    console.error("billing-nfse-reprocessar", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
