// Aplica um grupo de convites (uma ou mais empresas) a um usuário.
// deno-lint-ignore-file no-explicit-any
import { normalizeBRPhone, sendZapiText } from "./zapi.ts";
import {
  mensagemConviteProprietario, validarTitularidade,
  type EntradaTitularidade, type ResultadoTitularidade, type TitularidadeAtivacao,
} from "./convite-titularidade.ts";

const APP_URL = "https://aveto360.com";

export const WA_EMAIL_DOMAIN = "usuarios.aveto360.local";
export const waEmail = (digits: string) => `wa${digits}@${WA_EMAIL_DOMAIN}`;

/**
 * Empresa preparada pela Aveto (modo convite) ainda sem primeiro acesso: o
 * gestor precisa informar se é o proprietário ou o administrador.
 */
export async function conciergePendenteDoGrupo(admin: any, grupoId: string): Promise<boolean> {
  const { data } = await admin.from("concierge_provisionamentos")
    .select("company_id").eq("invite_grupo_id", grupoId).eq("modo", "convite").is("ativado_em", null).limit(1);
  return Array.isArray(data) && data.length > 0;
}

/** Valida a escolha recebida da tela; ausente = tela antiga (mantém o gestor como Dono). */
export function conferirTitularidade(
  entrada: EntradaTitularidade | null | undefined,
  whatsappGestor: string | null | undefined,
): ResultadoTitularidade | null {
  if (!entrada) return null;
  return validarTitularidade(entrada, { whatsappGestor });
}

export type ResultadoAplicacao = {
  empresas: string[];
  papel: "owner" | "admin" | null;
  proprietario: { nome: string | null; enviado: boolean; final: string | null } | null;
};

export async function aplicarGrupoConvite(
  admin: any, grupoId: string, userId: string, titularidade?: TitularidadeAtivacao | null,
): Promise<ResultadoAplicacao> {
  const { data: convites } = await admin
    .from("company_invites")
    .select("id, company_id, role, perfil, permissions, modulos, ver_saldos, ver_salarios, contas_permitidas, unidades_permitidas, expires_at, companies(name)")
    .eq("grupo_id", grupoId)
    .eq("status", "pending");

  const nomes: string[] = [];
  for (const c of convites ?? []) {
    if (new Date(c.expires_at) < new Date()) {
      await admin.from("company_invites").update({ status: "expired" }).eq("id", c.id);
      continue;
    }
    const { data: existing } = await admin
      .from("company_members").select("id").eq("company_id", c.company_id).eq("user_id", userId).maybeSingle();
    if (!existing) {
      const { error } = await admin.from("company_members").insert({
        company_id: c.company_id,
        user_id: userId,
        role: c.role,
        perfil: c.perfil ?? "personalizado",
        permissions: c.permissions ?? {},
        modulos: c.modulos ?? { financeiro: true, pessoas: true, conta: true },
        ver_saldos: c.ver_saldos ?? true,
        ver_salarios: c.ver_salarios ?? true,
        contas_permitidas: c.contas_permitidas ?? null,
        unidades_permitidas: c.unidades_permitidas ?? null,
      });
      if (error) throw new Error(error.message);
    }
    await admin.from("company_invites").update({ status: "accepted" }).eq("id", c.id);
    if (c.companies?.name) nomes.push(c.companies.name);
  }

  // Empresas preparadas pela Aveto (concierge): titularidade conforme a escolha
  // do gestor e teste grátis a partir de agora; proprietário indicado que aceita
  // o convite assume como Dono. Sem efeito para convites comuns.
  const { data: ativ, error: ativErr } = await admin.rpc("concierge_ativar", {
    p_grupo_id: grupoId,
    p_user_id: userId,
    p_papel: titularidade?.papel ?? null,
    p_proprietario_nome: titularidade?.proprietarioNome ?? null,
    p_proprietario_whatsapp: titularidade?.proprietarioWhatsapp ?? null,
    p_convidar_proprietario: titularidade?.convidarProprietario ?? false,
  });
  if (ativErr) console.error("concierge_ativar falhou", ativErr.message);

  const r = (ativ ?? {}) as {
    ativadas?: number; papel?: "owner" | "admin";
    proprietario_convite?: { token: string; nome: string | null; whatsapp: string; empresas: string[] } | null;
  };
  let proprietario: ResultadoAplicacao["proprietario"] = null;
  if (r.proprietario_convite?.token) {
    proprietario = await avisarProprietario(admin, userId, r.proprietario_convite);
  }
  return { empresas: nomes, papel: r.ativadas ? r.papel ?? null : null, proprietario };
}

/** WhatsApp oficial da Aveto ao proprietário indicado pelo administrador. */
async function avisarProprietario(
  admin: any, gestorId: string, conv: { token: string; nome: string | null; whatsapp: string; empresas: string[] },
): Promise<{ nome: string | null; enviado: boolean; final: string | null }> {
  const phone = normalizeBRPhone(conv.whatsapp);
  const final = String(conv.whatsapp ?? "").slice(-4) || null;
  if (!phone) return { nome: conv.nome, enviado: false, final };
  try {
    const { data: prof } = await admin.from("profiles").select("full_name").eq("user_id", gestorId).maybeSingle();
    const { data: existente } = await admin.rpc("resolve_login_identifier", { _identifier: waEmail(conv.whatsapp) });
    const msg = mensagemConviteProprietario({
      nome: conv.nome,
      gestor: (prof?.full_name as string | null) ?? null,
      empresa: (conv.empresas ?? []).join(", ") || "sua empresa",
      link: `${APP_URL}/convite/${conv.token}`,
      contaExiste: Array.isArray(existente) && existente.length > 0,
    });
    const s = await sendZapiText(phone, msg);
    if (s.ok) {
      await admin.from("company_invites").update({ whatsapp_sent_at: new Date().toISOString() }).eq("token", conv.token);
    }
    return { nome: conv.nome, enviado: !!s.ok, final };
  } catch (e) {
    console.error("[convite-proprietario] envio falhou", e instanceof Error ? e.message : String(e));
    return { nome: conv.nome, enviado: false, final };
  }
}
