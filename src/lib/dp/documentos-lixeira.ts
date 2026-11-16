import { supabase } from "@/integrations/supabase/client";
import { RegraNegada } from "@/lib/dp/regraAviso";
import { mensagemErroDocumento } from "@/lib/dp/documentos-oficial";

/**
 * Lixeira de documentos do acervo do DP.
 *
 * A exclusão no Histórico é lógica (o arquivo e a evidência ficam guardados).
 * Durante LIXEIRA_DIAS o gestor pode conferir e restaurar; o servidor é quem
 * decide o prazo e a permissão (`dp_documentos_lixeira` / `dp_documento_restaurar`).
 */
export const LIXEIRA_DIAS = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Motivo gravado quando a pessoa não escreve nenhum — não vale mostrar. */
export const MOTIVO_PADRAO_EXCLUSAO = "Excluído no Histórico de documentos";

export type ItemLixeira = {
  id: string;
  titulo: string | null;
  tipo: string;
  referencia_data: string | null;
  colaborador_id: string | null;
  colaborador_nome: string | null;
  unidade_id: string | null;
  unidade_nome: string | null;
  file_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  arquivado_em: string;
  arquivado_por: string | null;
  arquivado_por_nome: string | null;
  arquivamento_motivo: string | null;
  restaurar_ate: string;
};

/** Data-limite para restaurar (exclusão + 7 dias). */
export function prazoRestauracao(arquivadoEm: string | Date): Date {
  const base = arquivadoEm instanceof Date ? arquivadoEm : new Date(arquivadoEm);
  return new Date(base.getTime() + LIXEIRA_DIAS * DIA_MS);
}

/** Ainda dá para restaurar? */
export function podeRestaurar(arquivadoEm: string | Date, agora: Date = new Date()): boolean {
  return prazoRestauracao(arquivadoEm).getTime() > agora.getTime();
}

/** Dias inteiros restantes, arredondando para cima (0 = vencido). */
export function diasRestantes(arquivadoEm: string | Date, agora: Date = new Date()): number {
  const restante = prazoRestauracao(arquivadoEm).getTime() - agora.getTime();
  if (restante <= 0) return 0;
  return Math.ceil(restante / DIA_MS);
}

/** Texto do selo de prazo. */
export function rotuloPrazo(arquivadoEm: string | Date, agora: Date = new Date()): string {
  const restante = prazoRestauracao(arquivadoEm).getTime() - agora.getTime();
  if (restante <= 0) return "Prazo encerrado";
  if (restante < DIA_MS) {
    const horas = Math.max(1, Math.ceil(restante / (60 * 60 * 1000)));
    return horas === 1 ? "Última hora" : `${horas} horas restantes`;
  }
  const dias = diasRestantes(arquivadoEm, agora);
  return dias === 1 ? "1 dia restante" : `${dias} dias restantes`;
}

/** Motivo escrito pela pessoa; o texto automático não é exibido. */
export function motivoExibivel(motivo?: string | null): string | null {
  const t = (motivo ?? "").trim();
  if (!t || t === MOTIVO_PADRAO_EXCLUSAO) return null;
  return t;
}

/** Competência no formato MM/AAAA a partir da data de referência. */
export function competenciaLixeira(referencia?: string | null): string {
  if (!referencia) return "—";
  const m = /^(\d{4})-(\d{2})/.exec(referencia);
  return m ? `${m[2]}/${m[1]}` : "—";
}

const RECUSAS: Record<string, string> = {
  DOC_LIXEIRA_PRAZO_VENCIDO: `O prazo de ${LIXEIRA_DIAS} dias para restaurar este documento terminou.`,
  DOC_LIXEIRA_VERSAO_ATIVA:
    "Já existe outro documento ativo deste tipo e competência para esta pessoa. Exclua ou substitua o atual antes de restaurar.",
  DOC_LIXEIRA_NAO_EXCLUIDO: "Este documento não está na Lixeira.",
};

/** Traduz a recusa do servidor; recusas de regra viram aviso (não erro). */
export function erroRestauracao(erro: unknown): Error {
  const bruto = erro instanceof Error ? erro.message : String((erro as { message?: unknown } | null)?.message ?? erro ?? "");
  for (const [codigo, texto] of Object.entries(RECUSAS)) {
    if (bruto.includes(codigo)) return new RegraNegada(texto);
  }
  return new Error(mensagemErroDocumento(erro));
}

type Rpc = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
const cliente = () => supabase as unknown as Rpc;

export async function listarLixeira(companyId: string): Promise<ItemLixeira[]> {
  const { data, error } = await cliente().rpc("dp_documentos_lixeira", { p_company_id: companyId });
  if (error) throw new Error(mensagemErroDocumento(error));
  return (data ?? []) as ItemLixeira[];
}

export async function restaurarDocumentoLixeira(documentoId: string): Promise<void> {
  const { error } = await cliente().rpc("dp_documento_restaurar", { p_documento_id: documentoId });
  if (error) throw erroRestauracao(error);
}
