/**
 * Titularidade no primeiro acesso de empresa preparada pela Aveto 360.
 * O gestor informa se é o proprietário ou o administrador; como administrador,
 * informa o proprietário (nome + WhatsApp). Regra pura, compartilhada entre a
 * tela de convite e as funções do servidor (o banco repete a validação).
 */
export type PapelAtivacao = "owner" | "admin";

export interface TitularidadeAtivacao {
  papel: PapelAtivacao;
  proprietarioNome: string | null;
  /** Só dígitos, DDD + número (sem 55). */
  proprietarioWhatsapp: string | null;
  convidarProprietario: boolean;
}

export type EntradaTitularidade = {
  papel?: string | null;
  proprietarioNome?: string | null;
  proprietarioWhatsapp?: string | null;
  convidarProprietario?: boolean | null;
};

export type ResultadoTitularidade =
  | { ok: true; valor: TitularidadeAtivacao; campo?: undefined; erro?: undefined }
  | { ok: false; valor?: undefined; campo: "papel" | "nome" | "whatsapp"; erro: string };

/** DDD + número, sem o 55 do país. */
export function digitosFoneBR(raw: string | null | undefined): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  return d;
}

export function validarTitularidade(
  t: EntradaTitularidade | null | undefined,
  opts: { whatsappGestor?: string | null } = {},
): ResultadoTitularidade {
  const papel = t?.papel;
  if (papel !== "owner" && papel !== "admin") {
    return { ok: false, campo: "papel", erro: "Informe se você é o proprietário ou o administrador da empresa." };
  }
  if (papel === "owner") {
    return { ok: true, valor: { papel, proprietarioNome: null, proprietarioWhatsapp: null, convidarProprietario: false } };
  }
  const nome = String(t?.proprietarioNome ?? "").trim().replace(/\s+/g, " ");
  if (nome.replace(/[^\p{L}]/gu, "").length < 3) {
    return { ok: false, campo: "nome", erro: "Informe o nome do proprietário." };
  }
  const wa = digitosFoneBR(t?.proprietarioWhatsapp);
  if (wa.length !== 10 && wa.length !== 11) {
    return { ok: false, campo: "whatsapp", erro: "Informe o WhatsApp do proprietário com DDD." };
  }
  const gestor = digitosFoneBR(opts.whatsappGestor);
  if (gestor && gestor === wa) {
    return { ok: false, campo: "whatsapp", erro: "O WhatsApp do proprietário precisa ser diferente do seu." };
  }
  return {
    ok: true,
    valor: { papel, proprietarioNome: nome, proprietarioWhatsapp: wa, convidarProprietario: t?.convidarProprietario !== false },
  };
}

/** Mensagem oficial ao proprietário indicado pelo administrador na ativação. */
export function mensagemConviteProprietario(o: {
  nome: string | null; gestor: string | null; empresa: string; link: string; contaExiste: boolean;
}): string {
  const primeiro = (n: string | null) => {
    const p = String(n ?? "").trim().split(/\s+/)[0] ?? "";
    return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "";
  };
  const n = primeiro(o.nome);
  const g = primeiro(o.gestor);
  const quem = g ? `${g} ativou` : "Foi ativado";
  const inicio = `Olá${n ? `, ${n}` : ""}! Aqui é da equipe da *AVETO 360*.\n\n` +
    `${quem} o acesso da *${o.empresa}* e indicou você como proprietário(a) da empresa.\n\n`;
  return o.contaExiste
    ? `${inicio}Você já tem conta: toque no link e entre com a sua senha para assumir como Dono (válido por 15 dias):\n👉 ${o.link}\n\nNão reconhece esta empresa? Responda esta mensagem.`
    : `${inicio}Crie sua senha pelo link para assumir como Dono (válido por 15 dias):\n👉 ${o.link}\n\nNão reconhece esta empresa? Responda esta mensagem.`;
}
