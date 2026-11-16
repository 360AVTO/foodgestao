/**
 * Motivo didático para quando a pessoa tenta salvar uma senha nova que ainda
 * não atende à regra única (passwordPolicy.ts). Usado por BlocoNovaSenha em
 * todas as telas que DEFINEM senha, para o botão nunca ficar "mudo".
 */
import { avaliarSenha, MENSAGENS_SENHA, SENHA_MIN, type SenhaProblema } from "./passwordPolicy";

export type DadosPessoaisSenha = { nome?: string | null; email?: string | null; cpf?: string | null };

/** Requisitos obrigatórios em linguagem curta, na ordem do checklist. */
export const REQUISITO_CURTO: Partial<Record<SenhaProblema, string>> = {
  curta: `${SENHA_MIN} caracteres`,
  sem_maiuscula: "1 letra maiúscula",
  sem_minuscula: "1 letra minúscula",
  sem_numero: "1 número",
  sem_simbolo: "1 símbolo (@ # $ * ! ?)",
};

const ORDEM_REQUISITOS: SenhaProblema[] = ["curta", "sem_maiuscula", "sem_minuscula", "sem_numero", "sem_simbolo"];

function juntar(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/**
 * Retorna o que ainda impede salvar a senha, ou null quando está tudo certo.
 * Toda a avaliação é local: a senha não sai do navegador.
 */
export function motivoSenhaPendente(
  senha: string,
  confirma: string,
  dados?: DadosPessoaisSenha,
): string | null {
  if (!senha) return "Crie sua senha no primeiro campo.";
  const { problemas } = avaliarSenha(senha, dados);
  const faltando = ORDEM_REQUISITOS.filter((p) => problemas.includes(p)).map((p) => REQUISITO_CURTO[p] as string);
  if (faltando.length) return `Ainda falta na senha: ${juntar(faltando)}.`;
  if (problemas.length) return `${MENSAGENS_SENHA[problemas[0]]}.`;
  if (!confirma) return "Repita a mesma senha no campo de confirmação.";
  if (confirma !== senha) return "A confirmação está diferente da senha digitada.";
  return null;
}
