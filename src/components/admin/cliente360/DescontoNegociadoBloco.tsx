import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { notifyError } from "@/lib/notifyError";
import { competenciaTexto, dataTexto, pctTexto } from "@/lib/billing/descontoNegociado";

type Desconto = {
  id: string; module: string; percentual: number; mensalidades: number; motivo: string; subscription_id: string | null;
  aplicado_em: string | null; ultimo_vencimento_com_desconto: string | null; competencia_inicial: string | null;
  competencia_final: string | null; encerrado_em: string | null; revogado_em: string | null; revogado_motivo: string | null; created_at: string;
};

const MODULO: Record<string, string> = { pessoas: "Pessoas 360°", financeiro: "Financeiro 360°" };

function situacao(d: Desconto): { rotulo: string; variante: "secondary" | "outline" | "default" } {
  if (d.revogado_em) return { rotulo: "Revogado", variante: "outline" };
  if (d.encerrado_em) return { rotulo: "Encerrado", variante: "outline" };
  if (d.subscription_id) return { rotulo: "Em vigor", variante: "default" };
  return { rotulo: "Aguardando contratação", variante: "secondary" };
}

/** Desconto comercial negociado da conta: registrar antes da contratação, acompanhar e revogar. */
export function DescontoNegociadoBloco({ contaId }: { contaId: string }) {
  const qc = useQueryClient();
  const [novo, setNovo] = useState(false);
  const [revogar, setRevogar] = useState<Desconto | null>(null);
  const [modulo, setModulo] = useState("pessoas");
  const [pct, setPct] = useState("10");
  const [meses, setMeses] = useState("3");
  const [motivo, setMotivo] = useState("");

  const lista = useQuery({
    queryKey: ["admin-descontos-negociados", contaId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_descontos_negociados_lista", { _billing_account_id: contaId });
      if (error) throw error;
      return (data ?? []) as unknown as Desconto[];
    },
  });

  const fechar = () => { setNovo(false); setRevogar(null); setMotivo(""); };
  const atualizar = () => qc.invalidateQueries({ queryKey: ["admin-descontos-negociados", contaId] });

  const registrar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_desconto_negociado_registrar", {
        _billing_account_id: contaId, _module: modulo, _percentual: Number(pct.replace(",", ".")),
        _mensalidades: Number(meses), _motivo: motivo.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Desconto negociado registrado. Ele entra na contratação do cliente."); atualizar(); fechar(); },
    onError: (e) => notifyError(e, { surface: "Sistema", action: "registrar o desconto", fallback: "Não foi possível registrar o desconto" }),
  });

  const revogarM = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_desconto_negociado_revogar", { _id: revogar!.id, _motivo: motivo.trim() });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Desconto revogado. A mensalidade volta ao valor de tabela na rotina diária."); atualizar(); fechar(); },
    onError: (e) => notifyError(e, { surface: "Sistema", action: "revogar o desconto", fallback: "Não foi possível revogar o desconto" }),
  });

  const pctNum = Number(pct.replace(",", "."));
  const mesesNum = Number(meses);
  const formOk = pctNum > 0 && pctNum <= 50 && Number.isInteger(mesesNum) && mesesNum >= 1 && mesesNum <= 12 && motivo.trim().length >= 5;
  const abertos = (lista.data ?? []).filter((d) => !d.revogado_em && !d.encerrado_em);

  return (
    <div className="space-y-2 rounded border p-3" data-testid="descontos-negociados">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">Desconto negociado</span>
        <Button size="sm" variant="outline" onClick={() => setNovo(true)}>Registrar desconto</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Vale nas primeiras mensalidades após a contratação (e nos colaboradores acima da base desses meses). Depois, volta sozinho ao valor de tabela.
      </p>
      {lista.isLoading && <p className="text-xs text-muted-foreground">Carregando...</p>}
      {!lista.isLoading && (lista.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">Nenhum desconto negociado.</p>}
      {(lista.data ?? []).map((d) => {
        const s = situacao(d);
        return (
          <div key={d.id} className="space-y-1 rounded border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={s.variante}>{s.rotulo}</Badge>
              <span className="font-medium">{pctTexto(d.percentual)} · {d.mensalidades} {d.mensalidades === 1 ? "mensalidade" : "mensalidades"}</span>
              <span className="text-muted-foreground">{MODULO[d.module] ?? d.module}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {d.motivo}
              {d.subscription_id && ` · base até o vencimento de ${dataTexto(d.ultimo_vencimento_com_desconto)} · excedentes de ${competenciaTexto(d.competencia_inicial)} a ${competenciaTexto(d.competencia_final)}`}
              {d.revogado_em && ` · revogado em ${dataTexto(d.revogado_em)}${d.revogado_motivo ? ` (${d.revogado_motivo})` : ""}`}
            </div>
            {!d.revogado_em && !d.encerrado_em && (
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setRevogar(d)}>Revogar</Button>
            )}
          </div>
        );
      })}

      <Dialog open={novo} onOpenChange={(o) => !o && fechar()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar desconto negociado</DialogTitle>
            <DialogDescription>O cliente vê o desconto na contratação e o valor é calculado pelo servidor.</DialogDescription>
          </DialogHeader>
          {abertos.length > 0 && <p className="text-xs text-destructive">Já existe desconto em aberto nesta conta. Revogue-o antes de registrar outro do mesmo módulo.</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 sm:col-span-3">
              <Label>Módulo</Label>
              <Select value={modulo} onValueChange={setModulo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pessoas">Pessoas 360°</SelectItem>
                  <SelectItem value="financeiro">Financeiro 360°</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="dn-pct">Desconto (%)</Label>
              <Input id="dn-pct" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="dn-meses">Quantas mensalidades</Label>
              <Input id="dn-meses" inputMode="numeric" value={meses} onChange={(e) => setMeses(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="space-y-1 sm:col-span-3">
              <Label htmlFor="dn-motivo">Motivo da negociação</Label>
              <Textarea id="dn-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: negociação de entrada com a gestora" />
            </div>
          </div>
          {!formOk && <p className="text-xs text-muted-foreground">Informe de 0,01% a 50%, de 1 a 12 mensalidades e o motivo (mínimo 5 letras).</p>}
          <DialogFooter>
            <Button variant="outline" onClick={fechar}>Cancelar</Button>
            <Button disabled={!formOk || registrar.isPending} onClick={() => registrar.mutate()}>{registrar.isPending ? "Registrando..." : "Registrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revogar} onOpenChange={(o) => !o && fechar()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revogar desconto negociado</DialogTitle>
            <DialogDescription>
              {revogar?.subscription_id
                ? "A mensalidade em aberto volta ao valor de tabela na próxima rotina diária. Mensalidades pagas ou vencidas não mudam."
                : "O desconto deixa de aparecer na contratação."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="dn-rev">Motivo</Label>
            <Textarea id="dn-rev" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={fechar}>Cancelar</Button>
            <Button variant="destructive" disabled={motivo.trim().length < 5 || revogarM.isPending} onClick={() => revogarM.mutate()}>
              {revogarM.isPending ? "Revogando..." : "Revogar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
