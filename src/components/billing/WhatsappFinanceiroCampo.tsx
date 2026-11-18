import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatarWhatsapp, validarWhatsappCobranca } from "@/lib/billing/whatsappCobranca";

type Info = { tem_conta: boolean; whatsapp: string | null; pode_alterar: boolean };

/** WhatsApp do responsável financeiro: recebe a régua junto com o dono. */
export function WhatsappFinanceiroCampo({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["whatsapp-cobranca", companyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("billing_v2_whatsapp_cobranca_obter", { _company_id: companyId });
      if (error) throw error;
      return data as unknown as Info;
    },
  });

  const salvar = useMutation({
    mutationFn: async (novo: string | null) => {
      const { error } = await supabase.rpc("billing_v2_whatsapp_cobranca_definir", {
        _company_id: companyId, _whatsapp: novo ?? "",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("WhatsApp do financeiro atualizado.");
      setAberto(false);
      qc.invalidateQueries({ queryKey: ["whatsapp-cobranca", companyId] });
    },
    onError: (e: Error) => setErro(e.message || "Não foi possível salvar. Tente novamente."),
  });

  if (!q.data?.tem_conta) return null;
  const atual = q.data.whatsapp;

  const confirmar = () => {
    const r = validarWhatsappCobranca(valor);
    if (r.ok === false) { setErro(r.erro); return; }
    setErro(null);
    salvar.mutate(r.valor);
  };

  return (
    <div className="space-y-1 sm:col-span-2">
      <p className="text-xs text-muted-foreground">WhatsApp do financeiro</p>
      <div className="flex flex-wrap items-center gap-2">
        <p>{atual ? formatarWhatsapp(atual) : "Não informado"}</p>
        {q.data.pode_alterar && (
          <Button
            size="sm" variant="outline" data-testid="editar-whatsapp-financeiro"
            onClick={() => { setValor(atual ? formatarWhatsapp(atual) : ""); setErro(null); setAberto(true); }}
          >
            <MessageCircle className="mr-1 h-4 w-4" /> {atual ? "Alterar WhatsApp" : "Informar WhatsApp"}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Recebe pelo WhatsApp da Aveto 360 os lembretes de fatura e do plano, junto com os gestores da empresa.
      </p>

      <Dialog open={aberto} onOpenChange={(o) => !o && setAberto(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>WhatsApp do Financeiro</DialogTitle>
            <DialogDescription>
              Os lembretes de vencimento, de fim do teste e a confirmação de pagamento também chegam neste número.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="wa-financeiro">WhatsApp com DDD</Label>
            <Input
              id="wa-financeiro" inputMode="tel" autoComplete="tel" placeholder="(62) 99999-9999"
              value={valor} onChange={(e) => { setValor(e.target.value); setErro(null); }}
              aria-invalid={!!erro} aria-describedby={erro ? "wa-financeiro-erro" : undefined}
            />
            {erro && <p id="wa-financeiro-erro" className="text-sm text-destructive">{erro}</p>}
            <p className="text-xs text-muted-foreground">Deixe em branco para remover o número.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAberto(false)}>Cancelar</Button>
            <Button onClick={confirmar} disabled={salvar.isPending}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
