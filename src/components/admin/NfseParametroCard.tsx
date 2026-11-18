import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

type Config = { codigo_servico: string; nome_servico: string; descricao: string; iss: number };
type Item = { id: string; status: string; valor_cents: number; asaas_invoice_id: string | null; created_at: string; conta: string | null; erro: string | null; tentativas: number };

const STATUS: Record<string, { rotulo: string; variante: "default" | "secondary" | "destructive" | "outline" }> = {
  solicitada: { rotulo: "Enviada ao Asaas", variante: "default" },
  automatica_assinatura: { rotulo: "Automática", variante: "default" },
  recusada_asaas: { rotulo: "Recusada", variante: "destructive" },
  nao_emitida_valor_zero: { rotulo: "Valor zero", variante: "secondary" },
};

async function chamar(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("billing-nfse-reprocessar", { body });
  if (error) {
    let msg = error.message;
    if (error instanceof FunctionsHttpError) {
      try { msg = (await error.context.json())?.error ?? msg; } catch { /* mantém mensagem */ }
    }
    throw new Error(msg);
  }
  return data;
}

const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** NFS-e pelo Asaas (só super admin): liga/desliga, dados do serviço e reenvio de notas recusadas. */
export function NfseParametroCard() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["param-emitir-nfse"],
    queryFn: async () => {
      const { data, error } = await supabase.from("system_parameters").select("value,updated_at").eq("key", "emitir_nfse").maybeSingle();
      if (error) throw error;
      return data as { value: string; updated_at: string } | null;
    },
  });
  const lista = useQuery({
    queryKey: ["nfse-solicitacoes"],
    queryFn: async () => (await chamar({ acao: "listar" })) as { config: Config | null; itens: Item[] },
  });
  const m = useMutation({
    mutationFn: async (v: "ligado" | "desligado") => {
      const { error } = await (supabase as any).rpc("billing_v2_set_emitir_nfse", { _valor: v });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Parâmetro de nota fiscal atualizado."); qc.invalidateQueries({ queryKey: ["param-emitir-nfse"] }); },
    onError: (e: Error) => toast.error(e.message || "Não foi possível alterar."),
  });

  const [cfg, setCfg] = useState<Config>({ codigo_servico: "", nome_servico: "", descricao: "", iss: 0 });
  useEffect(() => { if (lista.data?.config) setCfg({ ...lista.data.config, iss: Number(lista.data.config.iss ?? 0) }); }, [lista.data?.config]);

  const salvar = useMutation({
    mutationFn: () => chamar({ acao: "salvar_config", ...cfg, iss: Number(cfg.iss) }),
    onSuccess: () => { toast.success("Dados do serviço salvos."); qc.invalidateQueries({ queryKey: ["nfse-solicitacoes"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const reenviar = useMutation({
    mutationFn: (id: string) => chamar({ acao: "reprocessar", solicitacao_id: id }),
    onSuccess: (r: any) => {
      if (r?.ok) toast.success("Nota reenviada ao Asaas.");
      else toast.error(r?.erro ?? "O Asaas recusou novamente.");
      qc.invalidateQueries({ queryKey: ["nfse-solicitacoes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ligado = q.data?.value === "ligado";
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">Nota Fiscal pelo Asaas <Badge variant={ligado ? "default" : "secondary"}>{ligado ? "Ligada" : "Desligada"}</Badge></CardTitle>
        <CardDescription>
          Emite NFS-e para o pagador da conta de cobrança ao confirmar o pagamento, com o endereço do cadastro da empresa. Nunca emite para valor zero.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Última alteração: {q.data?.updated_at ? new Date(q.data.updated_at).toLocaleString("pt-BR") : "—"}</span>
          <Switch checked={ligado} disabled={q.isLoading || m.isPending} aria-label="Emitir nota fiscal"
            onCheckedChange={(c) => m.mutate(c ? "ligado" : "desligado")} />
        </div>

        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}>
          <div className="space-y-1">
            <Label htmlFor="nfse-codigo">Código do serviço (Portal Nacional)</Label>
            <Input id="nfse-codigo" inputMode="decimal" placeholder="01.05.01" value={cfg.codigo_servico}
              onChange={(e) => setCfg({ ...cfg, codigo_servico: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="nfse-iss">Alíquota de ISS (%)</Label>
            <Input id="nfse-iss" type="number" step="0.01" min={0} max={5} value={cfg.iss}
              onChange={(e) => setCfg({ ...cfg, iss: Number(e.target.value) })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="nfse-nome">Nome do serviço</Label>
            <Input id="nfse-nome" value={cfg.nome_servico} onChange={(e) => setCfg({ ...cfg, nome_servico: e.target.value })} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="nfse-desc">Descrição na nota</Label>
            <Input id="nfse-desc" value={cfg.descricao} onChange={(e) => setCfg({ ...cfg, descricao: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={salvar.isPending || lista.isLoading}>Salvar dados do serviço</Button>
          </div>
        </form>

        <div className="space-y-2">
          <p className="font-medium">Últimas notas</p>
          {lista.isLoading && <p className="text-muted-foreground">Carregando…</p>}
          {lista.data && lista.data.itens.length === 0 && <p className="text-muted-foreground">Nenhuma nota solicitada ainda.</p>}
          <ul className="space-y-2">
            {lista.data?.itens.map((it) => {
              const st = STATUS[it.status] ?? { rotulo: it.status, variante: "outline" as const };
              return (
                <li key={it.id} className="rounded-md border p-3 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{it.conta ?? "Conta"} · {brl(it.valor_cents)}</span>
                    <Badge variant={st.variante}>{st.rotulo}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(it.created_at).toLocaleString("pt-BR")}{it.tentativas > 1 ? ` · ${it.tentativas} tentativas` : ""}
                  </p>
                  {it.status === "recusada_asaas" && it.erro && <p className="text-xs text-destructive break-words">{it.erro}</p>}
                  {it.status === "recusada_asaas" && (
                    <Button size="sm" variant="outline" disabled={reenviar.isPending} onClick={() => reenviar.mutate(it.id)}>
                      <RefreshCw className="mr-1 h-3.5 w-3.5" /> Reenviar nota
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
