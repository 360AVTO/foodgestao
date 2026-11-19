import { supabase } from "@/integrations/supabase/client";

export const INVITE_TOKEN_KEY = "invite_token";

export interface ConsumedInvite {
  accepted: boolean;
  companyName?: string | null;
  error?: string;
  /** Empresa preparada pela Aveto: a pessoa precisa responder na tela do convite. */
  redirect?: string;
}

/**
 * Aceita automaticamente o convite guardado quando a pessoa abriu o link do
 * e-mail antes de ter conta/login. Chamado logo após autenticar.
 */
export async function consumePendingInviteToken(): Promise<ConsumedInvite> {
  let token: string | null = null;
  try {
    token = sessionStorage.getItem(INVITE_TOKEN_KEY);
  } catch {
    return { accepted: false };
  }
  if (!token) return { accepted: false };

  try {
    const { data, error } = await supabase.functions.invoke("accept-invite", { body: { token } });
    const d = await lerCorpo(data, error);
    if (d?.code === "definir_titular") return { accepted: false, redirect: `/convite/${d.token ?? token}` };
    const errMsg = d?.error || error?.message;
    if (errMsg) return { accepted: false, error: errMsg };
    try {
      sessionStorage.removeItem(INVITE_TOKEN_KEY);
    } catch { /* noop */ }
    return { accepted: true, companyName: (data as any)?.company_name ?? null };
  } catch (e) {
    return { accepted: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Corpo JSON da resposta, inclusive quando a função devolve status de erro. */
export async function lerCorpo(data: unknown, error: unknown): Promise<any> {
  if (data) return data;
  const ctx = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context;
  if (ctx?.json) {
    try { return await ctx.json(); } catch { return null; }
  }
  return null;
}
