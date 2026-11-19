import { useRef, useState } from "react";
import { CheckCircle2, FileSearch, Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import {
  conferirCertificado,
  sha256DoArquivo,
  type CertificadoRegistrado,
  type ResultadoConferencia,
} from "@/lib/dp/certificadoConferencia";

type Props = { open: boolean; onOpenChange: (v: boolean) => void; companyId: string | null };

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

/**
 * Confere se um certificado de assinatura em PDF é o mesmo emitido pelo
 * AVETO 360: calcula a impressão digital no aparelho e procura no registro.
 */
export function ConferirCertificadoDialog({ open, onOpenChange, companyId }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [carregando, setCarregando] = useState(false);
  const [nome, setNome] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoConferencia | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  const limpar = () => { setNome(null); setResultado(null); setFalha(null); };

  const escolher = async (arquivo: File | undefined) => {
    if (!arquivo || !companyId) return;
    limpar();
    setNome(arquivo.name);
    setCarregando(true);
    try {
      const sha = await sha256DoArquivo(arquivo);
      const { data, error } = await supabase
        .from("dp_documento_certificados")
        .select("codigo, sha256, gerado_em, paginas, documento:documento_id(titulo)")
        .eq("company_id", companyId)
        .eq("sha256", sha)
        .limit(5);
      if (error) throw error;
      setResultado(conferirCertificado(sha, (data ?? []) as unknown as CertificadoRegistrado[]));
    } catch {
      setFalha("Não foi possível conferir agora. Tente novamente em instantes.");
    } finally {
      setCarregando(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(v) => { if (!v) limpar(); onOpenChange(v); }}
      title="Conferir certificado"
      description="Escolha o PDF do certificado de assinatura. O arquivo é conferido no seu aparelho e não é enviado."
    >
      <div className="space-y-4">
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => void escolher(e.target.files?.[0])}
        />
        <Button
          type="button"
          variant="outline"
          className="h-12 w-full gap-2 rounded-xl"
          disabled={carregando || !companyId}
          onClick={() => input.current?.click()}
        >
          {carregando
            ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            : <FileSearch className="h-4 w-4" aria-hidden="true" />}
          {nome ? "Escolher outro PDF" : "Escolher PDF"}
        </Button>
        {nome && <p className="break-all text-xs text-muted-foreground">{nome}</p>}

        {falha && <p role="alert" className="text-sm text-destructive">{falha}</p>}

        {resultado?.estado === "autentico" && (
          <div role="status" className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-primary">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              Certificado autêntico
            </p>
            <p className="text-sm text-foreground">
              Este arquivo é idêntico ao emitido pelo AVETO 360 e não foi alterado.
            </p>
            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Documento</dt>
              <dd className="min-w-0 break-words">{resultado.registro.documento?.titulo ?? "—"}</dd>
              <dt className="text-muted-foreground">Código</dt>
              <dd className="font-mono">{resultado.registro.codigo}</dd>
              <dt className="text-muted-foreground">Emitido em</dt>
              <dd>{dataHora(resultado.registro.gerado_em)}</dd>
              {resultado.registro.paginas ? (
                <>
                  <dt className="text-muted-foreground">Páginas</dt>
                  <dd>{resultado.registro.paginas}</dd>
                </>
              ) : null}
            </dl>
          </div>
        )}

        {resultado?.estado === "nao_encontrado" && (
          <div role="status" className="space-y-1 rounded-xl border border-destructive/40 bg-destructive/5 p-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              Não confere
            </p>
            <p className="text-sm text-foreground">
              Este arquivo não corresponde a nenhum certificado emitido para esta empresa. Ele pode ter sido
              alterado, ser de outra empresa ou ter sido gerado antes desta conferência existir — nesse caso,
              baixe o certificado de novo pelo documento.
            </p>
          </div>
        )}
      </div>
    </ResponsiveDialog>
  );
}
