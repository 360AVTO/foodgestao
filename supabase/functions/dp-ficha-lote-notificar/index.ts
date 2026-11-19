/**
 * Repasse do lote de fichas ao responsável da empresa, em nome da Aveto 360.
 * Exclusivo de super admin. Grava o aviso interno (RPC dp_ficha_lote_notificar,
 * chamada com a sessão de quem pediu), envia WhatsApp oficial da Aveto e e-mail,
 * e registra os canais no lote. Nunca cria colaboradores.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3.23.8";
import { enviarWhatsappAveto } from "../_shared/whatsapp-aveto.ts";
import { normalizeBRPhone } from "../_shared/zapi.ts";
import { sendTemplateEmail } from "../_shared/transactional-email-templates/send-email.ts";
import { linkConviteLote, linkLote, mensagemConviteLoteFicha, mensagemLoteFicha } from "../_shared/ficha-lote-aviso.ts";

const Body = z.object({
  importacaoId: z.string().uuid(),
  userId: z.string().uuid().optional().nullable(),
  /** Gestor de empresa preparada pela Aveto que ainda não criou a senha. */
  conviteId: z.string().uuid().optional().nullable(),
  whatsapp: z.string().trim().max(30).optional().nullable(),
}).refine((b) => !!b.userId !== !!b.conviteId, { message: "Informe a pessoa" });

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function erroRpc(m: string): { error: string; status: number } {
  if (/LOTE_SEM_PENDENCIAS/.test(m)) return { error: "Todas as fichas deste lote já foram concluídas.", status: 409 };
  if (/RESPONSAVEL_INVALIDO/.test(m)) return { error: "Escolha um dono ou administrador ativo da empresa.", status: 400 };
  if (/SEM_PERMISSAO/.test(m)) return { error: "Somente a equipe Aveto pode passar o lote ao responsável.", status: 403 };
  if (/LOTE_NAO_ENCONTRADO/.test(m)) return { error: "Lote não encontrado.", status: 404 };
  if (/CONVITE_INVALIDO/.test(m)) return { error: "O gestor já ativou o acesso. Atualize a tela e escolha o nome dele.", status: 409 };
  return { error: "Não foi possível salvar a notificação. Tente novamente.", status: 500 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  try {
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "Dados inválidos" }, 400);
    const { importacaoId, userId, conviteId } = parsed.data;

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !key || !anon) return json({ error: "Serviço indisponível" }, 503);
    const admin = createClient(url, key);

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Faça login" }, 401);
    const { data: claimsRes } = await admin.auth.getClaims(auth.slice(7));
    const uid = (claimsRes?.claims as Record<string, unknown> | undefined)?.sub as string | undefined;
    if (!uid) return json({ error: "Faça login" }, 401);
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: uid, _role: "super_admin" });
    if (!isAdmin) return json({ error: "Somente a equipe Aveto pode passar o lote ao responsável." }, 403);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    if (conviteId) return await repassarComConvite({ admin, userClient, uid, importacaoId, conviteId, whatsapp: parsed.data.whatsapp ?? null });

    // 1) Aviso interno + validação de responsável e pendências (com a sessão de quem pediu)
    const { data: rpc, error: rpcErr } = await userClient.rpc("dp_ficha_lote_notificar", {
      p_importacao_id: importacaoId, p_user_id: userId,
    });
    if (rpcErr) {
      const e = erroRpc(rpcErr.message ?? "");
      return json({ error: e.error }, e.status);
    }
    const notificacaoId = (rpc as { notificacao_id?: string })?.notificacao_id ?? null;
    const fichas = Number((rpc as { fichas?: number })?.fichas ?? 0);

    // 2) Dados do lote e do responsável
    const { data: lote } = await admin.from("dp_ficha_importacoes")
      .select("company_id, companies(name, trade_name)").eq("id", importacaoId).maybeSingle();
    // deno-lint-ignore no-explicit-any
    const emp = (lote as any)?.companies;
    const empresa = String(emp?.trade_name || emp?.name || "sua empresa").trim();
    const companyId = lote?.company_id as string;

    const { data: u } = await admin.auth.admin.getUserById(userId!);
    const email = u?.user?.email ?? null;
    const { data: prof } = await admin.from("profiles").select("full_name, phone").eq("user_id", userId).maybeSingle();
    const nome = (prof?.full_name as string | null) || email;
    let telefone = (parsed.data.whatsapp || "").trim() || (prof?.phone as string | null) || null;
    if (!telefone && email) {
      const { data: cp } = await admin.from("concierge_provisionamentos")
        .select("gestor_whatsapp, gestor_email").eq("company_id", companyId).maybeSingle();
      if (cp?.gestor_whatsapp && String(cp.gestor_email ?? "").toLowerCase() === email.toLowerCase()) {
        telefone = cp.gestor_whatsapp as string;
      }
    }

    const link = linkLote(importacaoId);
    const mensagem = mensagemLoteFicha({ nome, empresa, fichas, link });

    // 3) WhatsApp oficial da Aveto (registra em dp_whatsapp_envios)
    const wa = await enviarWhatsappAveto(telefone, mensagem, {
      admin, companyId, tipo: "lote_ficha", nome, link, enviadoPor: uid,
    });

    // 4) E-mail de retaguarda
    let emailEnviado = false; let emailErro: string | null = null;
    if (email) {
      try {
        const r = await sendTemplateEmail("ficha-lote-pronto", email, {
          idempotencyKey: `ficha-lote-pronto-${notificacaoId ?? `${importacaoId}-${Date.now()}`}`,
          templateData: { nome, empresa, fichas, link },
        });
        emailEnviado = r.sent;
        if (!r.sent) emailErro = "Este e-mail pediu para não receber mensagens da Aveto.";
      } catch (e) {
        console.error("[dp-ficha-lote-notificar] e-mail falhou", e instanceof Error ? e.message : String(e));
        emailErro = "Não foi possível enviar o e-mail agora.";
      }
    } else {
      emailErro = "Responsável sem e-mail cadastrado.";
    }

    // 5) Histórico do repasse no lote
    const canais = {
      whatsapp: { enviado: wa.enviado, final: wa.final ?? null, erro: wa.enviado ? null : wa.erro ?? null },
      email: { enviado: emailEnviado, destino: email, erro: emailEnviado ? null : emailErro },
    };
    const { error: regErr } = await admin.rpc("dp_ficha_lote_registrar_canais", {
      p_importacao_id: importacaoId, p_notificacao_id: notificacaoId, p_canais: canais,
    });
    if (regErr) console.error("[dp-ficha-lote-notificar] histórico não gravado", regErr.message);

    const digitos = normalizeBRPhone(telefone);
    return json({
      success: true,
      fichas,
      whatsapp: canais.whatsapp,
      email: canais.email,
      mensagem,
      link,
      telefone_contingencia: wa.enviado ? null : digitos,
    });
  } catch (e) {
    console.error("[dp-ficha-lote-notificar]", e instanceof Error ? e.message : String(e));
    return json({ error: "Erro interno" }, 500);
  }
});

/**
 * Lote passado a quem ainda não criou a senha (empresa preparada pela Aveto):
 * um único WhatsApp/e-mail com as fichas e o link de primeiro acesso, que abre
 * o lote depois da ativação. Convite vencido é renovado antes do envio.
 */
// deno-lint-ignore no-explicit-any
async function repassarComConvite(o: { admin: any; userClient: any; uid: string; importacaoId: string; conviteId: string; whatsapp: string | null }) {
  const { admin, userClient, uid, importacaoId } = o;
  const { data: rpc, error: rpcErr } = await userClient.rpc("dp_ficha_lote_notificar_convite", {
    p_importacao_id: importacaoId, p_invite_id: o.conviteId,
  });
  if (rpcErr) {
    const e = erroRpc(rpcErr.message ?? "");
    return json({ error: e.error }, e.status);
  }
  const notificacaoId = (rpc as { notificacao_id?: string })?.notificacao_id ?? null;
  const fichas = Number((rpc as { fichas?: number })?.fichas ?? 0);
  const companyId = (rpc as { company_id?: string })?.company_id as string;

  const { data: cp } = await admin.from("concierge_provisionamentos")
    .select("gestor_nome, gestor_email, gestor_whatsapp, conta_existente, invite_id, companies(name, trade_name)")
    .eq("company_id", companyId).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const emp = (cp as any)?.companies;
  const empresa = String(emp?.trade_name || emp?.name || "sua empresa").trim();

  let { data: inv } = await admin.from("company_invites").select("id, token, status, expires_at").eq("id", o.conviteId).maybeSingle();
  if (!inv || inv.status !== "pending" || new Date(inv.expires_at) < new Date()) {
    const { data: novo, error: renErr } = await userClient.rpc("admin_concierge_renovar_convite", { p_company_id: companyId });
    if (renErr || !novo?.token) return json({ error: "O link de acesso venceu e não foi possível gerar outro. Tente novamente." }, 500);
    inv = { id: novo.invite_id, token: novo.token, status: "pending", expires_at: "" };
  }

  const nome = (cp?.gestor_nome as string | null) ?? null;
  const telefone = (o.whatsapp || "").trim() || (cp?.gestor_whatsapp as string | null) || null;
  const link = linkConviteLote(inv.token, importacaoId);
  const mensagem = mensagemConviteLoteFicha({ nome, empresa, fichas, link, contaExistente: !!cp?.conta_existente });

  const wa = await enviarWhatsappAveto(telefone, mensagem, {
    admin, companyId, tipo: "lote_ficha", nome, link, enviadoPor: uid,
  });

  const email = (cp?.gestor_email as string | null) ?? null;
  let emailEnviado = false; let emailErro: string | null = null;
  if (email) {
    try {
      const r = await sendTemplateEmail("company-invite", email, {
        idempotencyKey: `ficha-lote-convite-${notificacaoId ?? `${importacaoId}-${Date.now()}`}`,
        templateData: { companyName: empresa, inviterName: "A equipe AVETO 360", role: "admin", inviteUrl: link },
      });
      emailEnviado = !!r.sent;
      if (!r.sent) emailErro = "Este e-mail pediu para não receber mensagens da Aveto.";
    } catch (e) {
      console.error("[dp-ficha-lote-notificar] e-mail do convite falhou", e instanceof Error ? e.message : String(e));
      emailErro = "Não foi possível enviar o e-mail agora.";
    }
  } else {
    emailErro = "Gestor sem e-mail cadastrado.";
  }

  const agora = new Date().toISOString();
  const upd: Record<string, string> = {};
  if (wa.enviado) upd.whatsapp_enviado_em = agora;
  if (emailEnviado) upd.email_enviado_em = agora;
  if (Object.keys(upd).length) await admin.from("concierge_provisionamentos").update(upd).eq("company_id", companyId);

  const canais = {
    whatsapp: { enviado: wa.enviado, final: wa.final ?? null, erro: wa.enviado ? null : wa.erro ?? null },
    email: { enviado: emailEnviado, destino: email, erro: emailEnviado ? null : emailErro },
  };
  const { error: regErr } = await admin.rpc("dp_ficha_lote_registrar_canais", {
    p_importacao_id: importacaoId, p_notificacao_id: notificacaoId, p_canais: canais,
  });
  if (regErr) console.error("[dp-ficha-lote-notificar] histórico não gravado", regErr.message);

  return json({
    success: true,
    fichas,
    convite: true,
    whatsapp: canais.whatsapp,
    email: canais.email,
    mensagem,
    link,
    telefone_contingencia: wa.enviado ? null : normalizeBRPhone(telefone),
  });
}
