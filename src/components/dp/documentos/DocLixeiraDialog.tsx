import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2, RotateCcw, Trash2, Clock } from "lucide-react";
import { toast } from "sonner";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DocumentPreview } from "@/components/dp/DocumentPreview";
import { docTipoLabel } from "@/lib/dp/documentoTipos";
import { notifyError } from "@/lib/notifyError";
import {
  LIXEIRA_DIAS, competenciaLixeira, diasRestantes, listarLixeira, motivoExibivel,
  restaurarDocumentoLixeira, rotuloPrazo, type ItemLixeira,
} from "@/lib/dp/documentos-lixeira";

export const lixeiraQueryKey = (companyId: string | null) => ["dp_doc_lixeira", companyId] as const;

/** Itens da Lixeira (também usado para o contador do botão). */
export function useDocLixeira(companyId: string | null) {
  return useQuery({
    queryKey: lixeiraQueryKey(companyId),
    enabled: !!companyId,
    staleTime: 30_000,
    queryFn: () => listarLixeira(companyId!),
  });
}

function fmtDataHora(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Botão da Lixeira com contador; some o número quando está vazia. */
export function BotaoLixeira(props: { companyId: string | null; onClick: () => void; className?: string; icone?: boolean }) {
  const { data } = useDocLixeira(props.companyId);
  const total = data?.length ?? 0;
  const rotulo = total > 0 ? `Lixeira (${total})` : "Lixeira";
  const ariaLabel = total > 0 ? `Lixeira, ${total} documento${total > 1 ? "s" : ""} para restaurar` : "Lixeira";
  if (props.icone) {
    // Ícone no topo (celular), ao lado de Lotes; o número vira um selo no canto.
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={props.onClick}
        aria-label={ariaLabel}
        title="Lixeira: documentos excluídos nos últimos 7 dias"
        className={props.className ?? "relative h-11 w-11 shrink-0 rounded-xl text-muted-foreground"}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
        {total > 0 && (
          <span
            className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground tabular-nums"
            aria-hidden="true"
          >
            {total > 99 ? "99+" : total}
          </span>
        )}
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      onClick={props.onClick}
      aria-label={ariaLabel}
      title="Documentos excluídos nos últimos 7 dias"
      className={props.className ?? "gap-2 px-3 sm:px-4"}
    >
      <Trash2 className="h-4 w-4" />
      <span>{rotulo}</span>
    </Button>
  );
}

/** Lixeira: documentos excluídos nos últimos 7 dias, com conferência e restauração. */
export function DocLixeiraDialog(props: {
  open: boolean;
  companyId: string | null;
  onOpenChange: (open: boolean) => void;
  /** Chamado após restaurar, para recarregar listas e pendências. */
  onRestaurado?: () => void;
}) {
  const queryClient = useQueryClient();
  const query = useDocLixeira(props.open ? props.companyId : null);
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const [preview, setPreview] = useState<ItemLixeira | null>(null);
  const itens = query.data ?? [];

  const restaurar = async (item: ItemLixeira) => {
    setRestaurando(item.id);
    try {
      await restaurarDocumentoLixeira(item.id);
      toast.success("Documento restaurado. Ele voltou para a lista de documentos.");
      await queryClient.invalidateQueries({ queryKey: lixeiraQueryKey(props.companyId) });
      queryClient.invalidateQueries({ queryKey: ["dp_doc_eventos_empresa"] });
      props.onRestaurado?.();
    } catch (e) {
      notifyError(e, { surface: "Lixeira de documentos", action: "restaurar o documento", fallback: "Não foi possível restaurar o documento" });
    } finally {
      setRestaurando(null);
    }
  };

  return (
    <>
      <ResponsiveDialog
        open={props.open}
        onOpenChange={props.onOpenChange}
        className="sm:max-w-2xl"
        title={
          <span className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-primary" /> Lixeira
          </span>
        }
        description={`Documentos excluídos nos últimos ${LIXEIRA_DIAS} dias. Confira o arquivo e restaure se foi engano.`}
      >
        {query.isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : query.isError ? (
          <div className="space-y-3 py-6 text-center text-sm text-muted-foreground">
            <p>Não foi possível carregar a Lixeira agora.</p>
            <Button variant="outline" size="sm" onClick={() => query.refetch()}>Tentar de novo</Button>
          </div>
        ) : itens.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Trash2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
            A Lixeira está vazia. Nenhum documento foi excluído nos últimos {LIXEIRA_DIAS} dias.
          </div>
        ) : (
          <ul className="space-y-3">
            {itens.map((item) => {
              const motivo = motivoExibivel(item.arquivamento_motivo);
              const dias = diasRestantes(item.arquivado_em);
              const ocupado = restaurando === item.id;
              return (
                <li key={item.id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-medium leading-snug">{item.colaborador_nome ?? "Sem colaborador"}</p>
                      <p className="text-sm text-muted-foreground">
                        {docTipoLabel(item.tipo)} · {competenciaLixeira(item.referencia_data)}
                        {item.unidade_nome ? ` · ${item.unidade_nome}` : ""}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`shrink-0 gap-1 ${dias <= 1 ? "border-destructive/40 text-destructive" : "text-muted-foreground"}`}
                    >
                      <Clock className="h-3 w-3" /> {rotuloPrazo(item.arquivado_em)}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Excluído por {item.arquivado_por_nome ?? "usuário"} em {fmtDataHora(item.arquivado_em)}
                  </p>
                  {motivo && <p className="mt-1 text-xs text-muted-foreground">Motivo: {motivo}</p>}
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                    <Button
                      variant="outline"
                      className="min-h-11 gap-2"
                      disabled={!item.file_path}
                      onClick={() => setPreview(item)}
                    >
                      <Eye className="h-4 w-4" /> Visualizar
                    </Button>
                    <Button className="min-h-11 gap-2" disabled={!!restaurando} onClick={() => restaurar(item)}>
                      {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      Restaurar
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ResponsiveDialog>

      <DocumentPreview
        open={!!preview}
        onOpenChange={(v) => { if (!v) setPreview(null); }}
        title={preview ? `${docTipoLabel(preview.tipo)} · ${preview.colaborador_nome ?? ""}` : undefined}
        bucket="dp-documentos"
        path={preview?.file_path ?? undefined}
        mime={preview?.mime_type}
      />
    </>
  );
}
