/**
 * Conferência de identidade do convite de usuário. A regra (quem é dono de
 * qual e-mail/WhatsApp) é decidida no banco por
 * `company_invite_conferir_identidade`; aqui só traduzimos o resultado em
 * aviso para o gestor e escolhemos o texto do convite.
 */
import { getPerfil, type PerfilKey } from "@/lib/permissions";

export type SituacaoIdentidade =
  | "nova"
  | "conta_existente"
  | "whatsapp_em_outra_conta"
  | "email_outra_pessoa"
  | "ja_membro";

export interface ConferenciaIdentidade {
  situacao: SituacaoIdentidade;
  conta_nome?: string | null;
  conta_login_mascarado?: string | null;
  login?: "email" | "whatsapp";
  membros?: { empresa: string; perfil: string | null; role?: string | null }[];
}

export interface AvisoIdentidade {
  tom: "erro" | "alerta" | "info";
  titulo: string;
  texto: string;
  /** Impede o envio do convite. */
  bloqueia: boolean;
}

const primeiro = (nome: string) => {
  const p = nome.trim().split(/\s+/)[0] ?? "";
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
};

const rotuloPerfil = (perfil: string | null | undefined) => {
  if (!perfil) return "Membro";
  try { return getPerfil(perfil as PerfilKey).label; } catch { return "Membro"; }
};

export function avisoIdentidadeConvite(
  c: ConferenciaIdentidade | null | undefined,
  nomeDigitado: string,
): AvisoIdentidade | null {
  if (!c) return null;
  const nome = primeiro(nomeDigitado) || "esta pessoa";
  const dona = c.conta_nome ?? "outra pessoa";
  switch (c.situacao) {
    case "ja_membro": {
      const lista = (c.membros ?? []).map((m) => `${m.empresa} (${rotuloPerfil(m.perfil)})`).join(", ");
      return {
        tom: "erro",
        bloqueia: true,
        titulo: "Esta pessoa já tem acesso",
        texto: `${c.conta_nome ?? nome} já faz parte de ${lista || "esta empresa"}. Para mudar o acesso, edite o usuário na lista.`,
      };
    }
    case "email_outra_pessoa":
      return {
        tom: "erro",
        bloqueia: true,
        titulo: "Este e-mail é de outra pessoa",
        texto: `O e-mail informado já pertence a ${dona}${dona.endsWith(".") ? "" : "."} Para convidar ${nome}, use o e-mail dela ou deixe o e-mail em branco para o acesso ser feito pelo WhatsApp.`,
      };
    case "conta_existente":
      return {
        tom: "info",
        bloqueia: false,
        titulo: "Já tem conta no Aveto 360",
        texto: `${c.conta_nome ?? nome} já tem conta. O convite vai incluir a empresa no acesso que ela já usa, sem criar outra senha.`,
      };
    case "whatsapp_em_outra_conta":
      return {
        tom: "alerta",
        bloqueia: false,
        titulo: "Este WhatsApp já tem conta com e-mail",
        texto: `O WhatsApp informado está na conta de ${dona}${c.conta_login_mascarado ? ` (${c.conta_login_mascarado})` : ""}. Para não criar uma segunda conta, informe o e-mail dessa conta.`,
      };
    default:
      return null;
  }
}

/** Texto do convite enviado pelo WhatsApp (envio manual pelo gestor). */
export function mensagemWhatsappConvite(nome: string, link: string, contaExiste: boolean) {
  const p = primeiro(nome);
  const ola = `Olá${p ? `, ${p}` : ""}!`;
  return contaExiste
    ? `${ola} Seu acesso a uma nova empresa no Aveto 360 foi liberado. Você já tem conta: toque no link e entre com a sua senha atual para confirmar: ${link}`
    : `${ola} Você foi convidado para acessar o Aveto 360. Crie sua senha pelo link: ${link}`;
}

/** Recusas do gatilho do servidor chegam com prefixo técnico; mostra só o motivo. */
export function motivoRecusaConvite(msg: string | null | undefined): string | null {
  const m = /convite_(?:ja_membro|email_outra_pessoa):\s*(.+)$/s.exec(msg ?? "");
  return m ? m[1].trim() : null;
}

/** Como mostrar o login de uma conta (WhatsApp vira final do número). */
export function rotuloLogin(email: string | null | undefined): string {
  const e = (email ?? "").toLowerCase();
  const wa = /^wa(\d{10,11})@usuarios\.aveto360\.local$/.exec(e);
  if (wa) return `WhatsApp com final ${wa[1].slice(-4)}`;
  const cpf = /^cpf(\d{11})@portal\.360food\.local$/.exec(e);
  if (cpf) return `CPF com final ${cpf[1].slice(-2)}`;
  return e;
}
