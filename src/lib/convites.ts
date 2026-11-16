// Regras puras dos convites da Gestão de Usuários.
// Um convite "pendente" cujo prazo já passou é tratado como vencido: o link
// não funciona mais (o aceite rejeita) e só a renovação devolve o acesso.

export type SituacaoConvite = "pendente" | "vencido" | "aceito" | "recusado";

export interface ConviteBase {
  status: string;
  expires_at?: string | null;
}

export function conviteVencido(invite: ConviteBase, agora: Date = new Date()): boolean {
  if (invite.status === "expired") return true;
  if (invite.status !== "pending" || !invite.expires_at) return false;
  return new Date(invite.expires_at).getTime() < agora.getTime();
}

export function situacaoConvite(invite: ConviteBase, agora: Date = new Date()): SituacaoConvite {
  if (invite.status === "accepted") return "aceito";
  if (invite.status === "rejected") return "recusado";
  return conviteVencido(invite, agora) ? "vencido" : "pendente";
}

export interface AcoesConvite {
  reenviar: boolean;
  copiar: boolean;
  cancelar: boolean;
  renovar: boolean;
  excluir: boolean;
}

export function acoesConvite(situacao: SituacaoConvite): AcoesConvite {
  return {
    reenviar: situacao === "pendente",
    copiar: situacao === "pendente",
    cancelar: situacao === "pendente",
    renovar: situacao === "vencido",
    excluir: situacao === "vencido" || situacao === "recusado",
  };
}

// Convites aceitos nunca são apagados junto com o grupo.
export const STATUS_EXCLUIVEIS = ["pending", "expired", "rejected"] as const;

export function mensagemErroRenovar(message: string | undefined | null): string {
  const m = message ?? "";
  if (m.includes("CONVITE_SEM_PERMISSAO")) return "Você não tem permissão para renovar este convite.";
  if (m.includes("CONVITE_NAO_RENOVAVEL")) return "Este convite já foi aceito ou recusado e não pode ser renovado.";
  if (m.includes("CONVITE_NAO_ENCONTRADO")) return "Convite não encontrado. Atualize a página.";
  if (m.includes("CONVITE_SEM_SESSAO")) return "Sua sessão expirou. Entre novamente.";
  return "Não foi possível renovar o convite. Tente novamente.";
}
