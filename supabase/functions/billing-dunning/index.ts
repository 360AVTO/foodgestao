// Régua de cobrança e trial do AVETO 360 — e-mail (aviso oficial) e WhatsApp
// (lembrete ao dono e ao responsável financeiro, só com o interruptor ligado).
//
// Duas etapas numa única invocação:
//  1) apura o estágio do dia (public.billing_dunning_scan) e enfileira os
//     avisos devidos em public.billing_notifications (índice único impede
//     duplicidade mesmo se a rotina rodar de novo); o WhatsApp fica agendado
//     para a próxima janela comercial (seg–sex, 9h30–11h e 15h–16h30);
//  2) drena a fila pendente, reconferindo antes de cada disparo se a fatura
//     segue em aberto, se a carência continua e se o plano não foi contratado.
//
// Autorização: verify_jwt = false. Aceita apenas
//   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>  ou
//   x-cron-secret: <BILLING_DUNNING_SECRET | PLUGGY_CRON_SECRET>
// Nenhuma claim de JWT é inspecionada.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { sendTemplateEmail } from "../_shared/transactional-email-templates/send-email.ts";
import { STAGE_NUMERO } from "../_shared/transactional-email-templates/billing-copy.ts";
import {
  mensagemWhatsapp, proximoEnvioWhatsapp, validadeWhatsapp,
} from "../_shared/billing-whatsapp.ts";
import { destinosWhatsappCobranca, whatsappReguaAtivo } from "../_shared/billing-whatsapp-envio.ts";
import { checkZapiStatus, sendZapiText } from "../_shared/zapi.ts";
import {
  ESTAGIOS_COM_INDICACAO, indicarPlanoPessoas, type IndicacaoPlano, type PlanoComPreco,
} from "../_shared/billing-plano-indicado.ts";

const SITE_URL = "https://www.aveto360.com";
const LOTE = 200;
const WA_POR_EXECUCAO = 40;
const WA_INTERVALO_MS = 1200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

const brl = (cents?: number | null) =>
  typeof cents === "number"
    ? (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "em aberto";

const dataBR = (iso?: string | null) => {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : null;
};

const somaDias = (iso: string, dias: number) => {
  const dt = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
};

const NIVEIS: Record<string, number> = {
  none: 0, consulta: 1, view: 1, inclusao: 2, alteracao: 3, total: 4, edit: 4,
};

type ScanRow = {
  company_id: string;
  subscription_id: string;
  invoice_id: string | null;
  stage: string;
  dias: number | null;
  amount_cents: number | null;
  due_date: string | null;
  expira_em: string | null;
  owner_user_id: string;
  company_name: string | null;
  company_cnpj: string | null;
  company_email: string | null;
  payment_url: string | null;
  modulo: string | null;
};

function nomeModulo(m: string | null): string | undefined {
  if (!m) return undefined;
  if (m === 'financeiro' || m === 'financial') return 'Financeiro 360°';
  if (m === 'dp' || m === 'pessoas') return 'Pessoas 360°';
  return undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const expectedSecret = Deno.env.get("BILLING_DUNNING_SECRET") ??
    Deno.env.get("PLUGGY_CRON_SECRET") ?? "";

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  const cronSecret = req.headers.get("x-cron-secret") ?? "";

  const ok = timingSafeEqual(bearer, serviceRoleKey) ||
    (expectedSecret.length > 0 && timingSafeEqual(cronSecret, expectedSecret));
  if (!ok) return json({ ok: false, error: "Forbidden" }, 403);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

  const emailCache = new Map<string, string | null>();
  async function emailDe(userId: string): Promise<string | null> {
    if (emailCache.has(userId)) return emailCache.get(userId) ?? null;
    const { data } = await admin.auth.admin.getUserById(userId);
    const mail = data?.user?.email?.toLowerCase() ?? null;
    emailCache.set(userId, mail);
    return mail;
  }

  const nomeCache = new Map<string, string | null>();
  async function nomeDe(userId: string): Promise<string | null> {
    if (nomeCache.has(userId)) return nomeCache.get(userId) ?? null;
    const { data } = await admin.from("profiles").select("full_name").eq("user_id", userId)
      .maybeSingle();
    const nome = (data?.full_name as string | null)?.split(" ")[0] ?? null;
    nomeCache.set(userId, nome);
    return nome;
  }

  /** Dono + membros com conta.assinatura (>= consulta) + e-mail da empresa + e-mail do responsável financeiro. */
  async function destinatarios(row: ScanRow): Promise<{ email: string; nome: string | null }[]> {
    const saida = new Map<string, string | null>();

    const donoEmail = await emailDe(row.owner_user_id);
    if (donoEmail) saida.set(donoEmail, await nomeDe(row.owner_user_id));

    const { data: membros } = await admin.from("company_members")
      .select("user_id, role, permissions, modulos, situacao")
      .eq("company_id", row.company_id);

    for (const m of membros ?? []) {
      if (m.situacao !== "ativo") continue;
      const role = String(m.role ?? "");
      const moduloOk = (m.modulos as Record<string, boolean> | null)?.conta === true;
      const nivel = NIVEIS[String((m.permissions as Record<string, string> | null)?.["conta.assinatura"] ?? "none")] ?? 0;
      if (!(["owner", "admin"].includes(role) || (moduloOk && nivel >= 1))) continue;
      const mail = await emailDe(String(m.user_id));
      if (mail && !saida.has(mail)) saida.set(mail, await nomeDe(String(m.user_id)));
    }

    const emailEmpresa = row.company_email?.toLowerCase().trim();
    if (emailEmpresa && emailEmpresa.includes("@") && !saida.has(emailEmpresa)) {
      saida.set(emailEmpresa, null);
    }

    // Responsável financeiro informado no cadastro da empresa
    const { data: emp } = await admin.from("companies").select("financeiro_email, financeiro_nome")
      .eq("id", row.company_id).maybeSingle();
    const finEmail = String(emp?.financeiro_email ?? "").toLowerCase().trim();
    if (finEmail.includes("@")) {
      const finNome = String(emp?.financeiro_nome ?? "").trim().split(/\s+/)[0] || null;
      if (!saida.has(finEmail) || saida.get(finEmail) === null) saida.set(finEmail, finNome);
    }

    return [...saida.entries()].map(([email, nome]) => ({ email, nome }));
  }

  function dadosDoEstagio(row: ScanRow, nome: string | null) {
    const venc = row.due_date;
    const link = row.invoice_id
      ? `${SITE_URL}/checkout/pagamento/${row.invoice_id}`
      : `${SITE_URL}/assinatura`;
    return {
      stage: row.stage,
      nome,
      empresa: row.company_name ?? undefined,
      cnpj: row.company_cnpj ?? undefined,
      valor: row.amount_cents != null ? brl(row.amount_cents) : undefined,
      data: dataBR(venc) ?? undefined,
      diasAtraso: row.dias ?? undefined,
      dataSuspensao: venc ? dataBR(somaDias(venc, 11)) ?? undefined : undefined,
      dataRescisao: venc ? dataBR(somaDias(venc, 31)) ?? undefined : undefined,
      dataExpiracao: row.expira_em ? dataBR(row.expira_em) ?? undefined : undefined,
      link: row.payment_url ?? link,
      linkExportacao: `${SITE_URL}/acesso-bloqueado`,
      linkPlanos: `${SITE_URL}/planos`,
      modulo: nomeModulo(row.modulo),
      // reta final do teste: dias que realmente faltam (o aviso pode ser antecipado no fim de semana)
      ...(row.stage === "trial_d5" || row.stage === "trial_d7"
        ? { diasRestantes: Math.max(0, -(row.dias ?? 0)) }
        : {}),
    };
  }

  // Plano indicado (Pessoas 360°): só fatos do banco — colaboradores ativos da
  // conta de cobrança e unidades ativas —, com a mesma regra da tela de planos.
  let catalogoPessoas: PlanoComPreco[] | null = null;
  const indicacaoCache = new Map<string, IndicacaoPlano | null>();
  async function indicacaoDe(row: ScanRow): Promise<Record<string, unknown>> {
    if (!ESTAGIOS_COM_INDICACAO.has(row.stage)) return {};
    if (!(row.modulo === "pessoas" || row.modulo === "dp")) return {};
    try {
      if (!indicacaoCache.has(row.company_id)) {
        if (!catalogoPessoas) {
          const { data } = await admin.from("plans")
            .select("slug, name, module, sort_order, is_enterprise, features, price_monthly_cents")
            .eq("module", "pessoas").eq("is_active", true).eq("is_public", true);
          catalogoPessoas = (data ?? []) as PlanoComPreco[];
        }
        const { data: vinc } = await admin.from("billing_account_companies").select("billing_account_id")
          .eq("company_id", row.company_id).is("removed_at", null).limit(1).maybeSingle();
        const { data: colab, error: colabErr } = await admin.rpc("_billing_v2_colaboradores_ativos", {
          _billing_account_id: vinc?.billing_account_id ?? null,
          _company_id: row.company_id,
        });
        const { count: unidades } = await admin.from("dp_unidades")
          .select("id", { count: "exact", head: true })
          .eq("company_id", row.company_id).eq("ativo", true);
        indicacaoCache.set(row.company_id, colabErr
          ? null
          : indicarPlanoPessoas(catalogoPessoas, { colaboradores: Number(colab ?? 0), unidades: unidades ?? 0 }, SITE_URL));
      }
      const ind = indicacaoCache.get(row.company_id);
      if (!ind) return {};
      return ind.tipo === "plano"
        ? { indicacao: "plano", colaboradores: ind.colaboradores, plano: ind.plano, detalhePlano: ind.detalhePlano, plano_slug: ind.slug, linkPlanos: ind.linkPlanos }
        : { indicacao: ind.tipo, colaboradores: ind.colaboradores, linkPlanos: ind.linkPlanos };
    } catch (e) {
      // Sem indicação o lembrete sai como antes (genérico) — nunca com dado inventado.
      console.error("[billing-dunning] indicação:", e instanceof Error ? e.message : e);
      return {};
    }
  }

  try {
    const waAtivo = await whatsappReguaAtivo(admin);

    // ---------- 1) apuração e enfileiramento -------------------------------
    const { data: alvos, error: scanErr } = await admin.rpc("billing_dunning_scan");
    if (scanErr) throw scanErr;

    let enfileirados = 0;
    for (const row of (alvos ?? []) as ScanRow[]) {
      const pessoas = await destinatarios(row);
      const indicacao = await indicacaoDe(row);
      for (const p of pessoas) {
        const payload = { ...dadosDoEstagio(row, p.nome), ...indicacao };
        const { error } = await admin.from("billing_notifications").insert({
          company_id: row.company_id,
          subscription_id: row.subscription_id,
          invoice_id: row.invoice_id,
          stage: row.stage,
          channel: "email",
          recipient: p.email,
          payload,
        });
        // 23505 = já enfileirado antes (índice único) → não é erro
        if (!error) enfileirados++;
        else if (error.code !== "23505") {
          console.error("[billing-dunning] enqueue:", error.code, error.message);
        }
      }
      if (waAtivo && mensagemWhatsapp(row.stage, {}) !== null) {
        const agora = new Date();
        const numeros = await destinosWhatsappCobranca(admin, row.company_id, row.owner_user_id);
        for (const n of numeros) {
          // Sem repetir o mesmo aviso para o mesmo número (ex.: teste dos dois módulos)
          if (!row.invoice_id) {
            const { count } = await admin.from("billing_notifications")
              .select("id", { count: "exact", head: true })
              .eq("company_id", row.company_id).eq("stage", row.stage)
              .eq("channel", "whatsapp").eq("recipient", n.phone)
              .gte("created_at", new Date(agora.getTime() - 3 * 24 * 3600 * 1000).toISOString());
            if ((count ?? 0) > 0) continue;
          }
          const payload = {
            ...dadosDoEstagio(row, n.nome),
            ...indicacao,
            papel: n.papel,
            wa_valido_ate: validadeWhatsapp(row.stage, agora).toISOString(),
          };
          const { error } = await admin.from("billing_notifications").insert({
            company_id: row.company_id,
            subscription_id: row.subscription_id,
            invoice_id: row.invoice_id,
            stage: row.stage,
            channel: "whatsapp",
            recipient: n.phone,
            payload,
            scheduled_at: proximoEnvioWhatsapp(row.stage, agora).toISOString(),
          });
          if (!error) enfileirados++;
          else if (error.code !== "23505") {
            console.error("[billing-dunning] enqueue whatsapp:", error.code, error.message);
          }
        }
      }

      const numero = STAGE_NUMERO[row.stage];
      if (typeof numero === "number" && numero > 0) {
        await admin.rpc("billing_set_dunning_stage", {
          _subscription_id: row.subscription_id,
          _stage: numero,
        });
      }
    }

    // ---------- 2) drenagem da fila ---------------------------------------
    const { data: fila, error: filaErr } = await admin.from("billing_notifications")
      .select("id, company_id, stage, channel, recipient, invoice_id, subscription_id, payload, attempts")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString())
      .lt("attempts", 5)
      .order("scheduled_at", { ascending: true })
      .limit(LOTE);
    if (filaErr) throw filaErr;

    let enviados = 0, cancelados = 0, falhas = 0, waEnviados = 0;
    let zapiConectado: boolean | null = null;

    const cancelar = async (id: string, motivo: string) => {
      await admin.from("billing_notifications")
        .update({ status: "cancelled", last_error: motivo }).eq("id", id);
      cancelados++;
    };

    // Régua pausada por negociação: nada sai enquanto a pausa valer (inclusive o que já estava na fila).
    const pausaCache = new Map<string, boolean>();
    const pausada = async (subId: string) => {
      if (!pausaCache.has(subId)) {
        const { data: sub } = await admin.from("subscriptions").select("dunning_paused_until")
          .eq("id", subId).maybeSingle();
        const ate = sub?.dunning_paused_until ? new Date(String(sub.dunning_paused_until)).getTime() : 0;
        pausaCache.set(subId, ate > Date.now());
      }
      return pausaCache.get(subId) === true;
    };

    for (const item of fila ?? []) {
      const payloadItem = (item.payload ?? {}) as Record<string, unknown>;
      if (item.subscription_id && item.stage !== "reativacao" && payloadItem.avulso !== true
        && await pausada(String(item.subscription_id))) {
        await cancelar(item.id, "régua pausada por negociação");
        continue;
      }

      // reconferência: fatura quitada no meio do caminho cancela o envio
      if (item.invoice_id && item.stage !== "reativacao") {
        const { data: fat } = await admin.from("invoices").select("status")
          .eq("id", item.invoice_id).maybeSingle();
        if (fat && !["open", "overdue"].includes(String(fat.status))) {
          await admin.from("billing_notifications")
            .update({ status: "cancelled", last_error: "fatura quitada antes do envio" })
            .eq("id", item.id);
          cancelados++;
          continue;
        }
      }

      // carência: só envia se a assinatura continua em carência
      if (String(item.stage).startsWith("grace_") && item.subscription_id) {
        const { data: sub } = await admin.from("subscriptions").select("status")
          .eq("id", item.subscription_id).maybeSingle();
        if (!sub || String(sub.status) !== "grace") {
          await admin.from("billing_notifications")
            .update({ status: "cancelled", last_error: "carência encerrada antes do envio" })
            .eq("id", item.id);
          cancelados++;
          continue;
        }
      }

      // pós-teste: plano contratado antes do envio encerra as tentativas
      if (String(item.stage).startsWith("trial_pos_")) {
        const { count } = await admin.from("subscriptions")
          .select("id", { count: "exact", head: true })
          .eq("company_id", item.company_id).eq("asaas_env", "production")
          .in("status", ["active", "grace", "past_due"]);
        if ((count ?? 0) > 0) {
          await cancelar(item.id, "plano contratado antes do envio");
          continue;
        }
      }

      if (item.channel === "whatsapp") {
        const payload = (item.payload ?? {}) as Record<string, unknown>;
        // Envio avulso autorizado pelo super admin não depende do interruptor da régua
        if (!waAtivo && payload.avulso !== true) { await cancelar(item.id, "WhatsApp da régua desligado"); continue; }
        const validoAte = payload.wa_valido_ate ? new Date(String(payload.wa_valido_ate)) : null;
        if (validoAte && Date.now() > validoAte.getTime()) {
          await cancelar(item.id, "fora do prazo do aviso (o e-mail já foi enviado)");
          continue;
        }
        const quando = proximoEnvioWhatsapp(item.stage, new Date());
        if (quando.getTime() > Date.now()) {
          await admin.from("billing_notifications")
            .update({ scheduled_at: quando.toISOString() }).eq("id", item.id);
          continue;
        }
        if (waEnviados >= WA_POR_EXECUCAO) continue;
        const texto = mensagemWhatsapp(item.stage, payload as never);
        if (!texto) { await cancelar(item.id, "estágio sem mensagem de WhatsApp"); continue; }

        if (zapiConectado === null) zapiConectado = (await checkZapiStatus()).connected;
        const tentativas = (item.attempts ?? 0) + 1;
        if (!zapiConectado) {
          await admin.from("billing_notifications").update({
            status: tentativas >= 5 ? "failed" : "pending",
            attempts: tentativas,
            last_error: "WhatsApp da Aveto desconectado",
            scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          }).eq("id", item.id);
          falhas++;
          continue;
        }
        if (waEnviados > 0) await sleep(WA_INTERVALO_MS);
        const r = await sendZapiText(item.recipient, texto);
        if (r.ok) {
          await admin.from("billing_notifications").update({
            status: "sent",
            sent_at: new Date().toISOString(),
            attempts: tentativas,
            provider_message_id: r.messageId ?? `zapi-${item.id}`,
            last_error: null,
          }).eq("id", item.id);
          enviados++; waEnviados++;
        } else {
          await admin.from("billing_notifications").update({
            status: tentativas >= 3 ? "failed" : "pending",
            attempts: tentativas,
            last_error: tentativas >= 3
              ? "Não foi possível entregar neste número. Confira o WhatsApp com DDD."
              : `falha temporária no envio (${r.error ?? "zapi"})`,
            scheduled_at: new Date(Date.now() + tentativas * 30 * 60 * 1000).toISOString(),
          }).eq("id", item.id);
          falhas++; waEnviados++;
        }
        continue;
      }

      try {
        const r = await sendTemplateEmail("billing-dunning", item.recipient, {
          templateData: item.payload as Record<string, unknown>,
          idempotencyKey: `billing-dunning-${item.id}`,
        });
        if (r.sent) {
          await admin.from("billing_notifications").update({
            status: "sent",
            sent_at: new Date().toISOString(),
            attempts: (item.attempts ?? 0) + 1,
            provider_message_id: `billing-dunning-${item.id}`,
          }).eq("id", item.id);
          enviados++;
        } else {
          await admin.from("billing_notifications").update({
            status: "cancelled",
            last_error: r.reason,
            attempts: (item.attempts ?? 0) + 1,
          }).eq("id", item.id);
          cancelados++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "erro desconhecido";
        const tentativas = (item.attempts ?? 0) + 1;
        await admin.from("billing_notifications").update({
          status: tentativas >= 5 ? "failed" : "pending",
          attempts: tentativas,
          last_error: msg.slice(0, 500),
          scheduled_at: new Date(Date.now() + tentativas * 30 * 60 * 1000).toISOString(),
        }).eq("id", item.id);
        falhas++;
        console.error("[billing-dunning] envio:", msg);
      }
    }

    return json({ ok: true, whatsapp_ativo: waAtivo, alvos: (alvos ?? []).length, enfileirados, enviados, whatsapp_enviados: waEnviados, cancelados, falhas });
  } catch (e) {
    console.error("[billing-dunning]", e instanceof Error ? e.message : e);
    return json({ ok: false, error: "Falha na régua de cobrança" }, 500);
  }
});
