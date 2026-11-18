// Contatos da empresa: proprietário do negócio (pode não ter acesso ao sistema)
// e responsável financeiro/cobrança. O proprietário só recebe cobranças com a
// opção ligada — nasce desligada.
import { validarWhatsappCobranca } from "@/lib/billing/whatsappCobranca";

export type ContatosEmpresaForm = {
  proprietarioNome: string;
  proprietarioWhatsapp: string;
  proprietarioRecebe: boolean;
  financeiroNome: string;
  financeiroEmail: string;
};

export type ContatosEmpresaDb = {
  proprietario_nome: string | null;
  proprietario_whatsapp: string | null;
  proprietario_recebe_cobranca: boolean;
  financeiro_nome: string | null;
  financeiro_email: string | null;
};

export type CampoContato = keyof ContatosEmpresaForm;

export const CONTATOS_VAZIOS: ContatosEmpresaForm = {
  proprietarioNome: "",
  proprietarioWhatsapp: "",
  proprietarioRecebe: false,
  financeiroNome: "",
  financeiroEmail: "",
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const texto = (v: string) => {
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t : null;
};

export function validarContatosEmpresa(
  f: ContatosEmpresaForm,
): { ok: true; valor: ContatosEmpresaDb } | { ok: false; erros: Partial<Record<CampoContato, string>> } {
  const erros: Partial<Record<CampoContato, string>> = {};
  const nomeProp = texto(f.proprietarioNome);
  const nomeFin = texto(f.financeiroNome);
  if (nomeProp && nomeProp.length > 120) erros.proprietarioNome = "Use até 120 caracteres.";
  if (nomeFin && nomeFin.length > 120) erros.financeiroNome = "Use até 120 caracteres.";

  const wa = validarWhatsappCobranca(f.proprietarioWhatsapp);
  if (wa.ok === false) erros.proprietarioWhatsapp = wa.erro;
  else if (f.proprietarioRecebe && !wa.valor) {
    erros.proprietarioWhatsapp = "Informe o WhatsApp do proprietário para ele receber as cobranças.";
  }

  const email = f.financeiroEmail.trim().toLowerCase() || null;
  if (email && (email.length > 150 || !EMAIL.test(email))) erros.financeiroEmail = "E-mail inválido.";

  if (Object.keys(erros).length) return { ok: false, erros };
  return {
    ok: true,
    valor: {
      proprietario_nome: nomeProp,
      proprietario_whatsapp: wa.ok ? wa.valor : null,
      proprietario_recebe_cobranca: f.proprietarioRecebe && Boolean(wa.ok && wa.valor),
      financeiro_nome: nomeFin,
      financeiro_email: email,
    },
  };
}

/** Lê do cadastro gravado para o formulário. */
export function contatosDoCadastro(c: Partial<ContatosEmpresaDb> | null | undefined): ContatosEmpresaForm {
  return {
    proprietarioNome: c?.proprietario_nome ?? "",
    proprietarioWhatsapp: c?.proprietario_whatsapp ? formatar(c.proprietario_whatsapp) : "",
    proprietarioRecebe: c?.proprietario_recebe_cobranca === true,
    financeiroNome: c?.financeiro_nome ?? "",
    financeiroEmail: c?.financeiro_email ?? "",
  };
}

function formatar(d: string) {
  const local = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return d;
}
