import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { RefreshCw, PauseCircle, PlayCircle, Mail, MessageCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { formatarWhatsapp } from "@/lib/billing/whatsappCobranca";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type Row = {
  id: string;
  company_id: string;
  empresa: string | null;
  subscription_id: string | null;
  invoice_id: string | null;
  stage: string;
  channel: string;
  recipient: string;
  status: string;
  attempts: number;
  last_error: string | null;
  provider_message_id: string | null;
  scheduled_at: string;
  sent_at: string | null;
  created_at: string;
  pausada_ate: string | null;
  pausa_motivo: string | null;
};

const ESTAGIOS: Record<string, string> = {
  d_menos_3: "D-3 · Lembrete",
  d_0: "D0 · Vencimento",
  d_mais_1: "D+1 · Atraso",
  d_mais_5: "D+5 · Tolerância",
  d_mais_8: "D+8 · Aviso de suspensão",
  d_mais_10: "D+10 · Último aviso",
  d_mais_11: "D+11 · Suspensão efetivada",
  d_mais_20: "D+20 · Suspenso",
  d_mais_28: "D+28 · Aviso de rescisão",
  d_mais_31: "D+31 · Rescisão (formal)",
  d_mais_60: "D+60 · Rescindido",
  d_mais_80: "D+80 · Aviso de expiração",
  d_mais_90: "D+90 · Expiração",
  reativacao: "Pagamento · Reativação",
  trial_d5: "Trial D5 · Termina em 2 dias",
  trial_d7: "Trial D7 · Encerrado",
  trial_pos_1: "Pós-teste D+1 · Tentativa 1",
  trial_pos_4: "Pós-teste D+4 · Tentativa 2",
  trial_pos_8: "Pós-teste D+8 · Tentativa 3",
  trial_pos_3: "Trial +3 · Reengajamento (antigo)",
  trial_pos_10: "Trial +10 · Último contato (antigo)",
  cortesia_encerrada: "Cortesia encerrada",
  grace_d_menos_3: "Carência · Faltam 3 dias",
  grace_d_menos_1: "Carência · Último dia amanhã",
  grace_d0: "Carência · Termina hoje",
};

type Config = { whatsapp_ativo: boolean; atualizado_em: string | null; atualizado_por: string | null };
type Funil = {
  dias: number; encerrados: number; tentativa_1: number; tentativa_2: number; tentativa_3: number;
  contrataram: number; contratou_sem_tentativa: number; contratou_apos_1: number;
  contratou_apos_2: number; contratou_apos_3: number;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  sent: "Enviado",
  failed: "Falhou",
  cancelled: "Cancelado",
};

const statusVariant = (s: string) =>
  s === "sent" ? "default" : s === "failed" ? "destructive" : s === "cancelled" ? "outline" : "secondary";

const dataHora = (v?: string | null) =>
  v ? format(new Date(v), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "—";

export default function AdminReguaCobranca() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<string>("todos");
  const [canal, setCanal] = useState<string>("todos");
  const [confirmarWa, setConfirmarWa] = useState<boolean | null>(null);
  const [pausando, setPausando] = useState<Row | null>(null);
  const [dias, setDias] = useState("15");
  const [motivo, setMotivo] = useState("");

  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["regua-cobranca", status, canal],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("billing_regua_historico", {
        _busca: null,
        _status: status === "todos" ? null : status,
        _canal: canal === "todos" ? null : canal,
        _limite: 300,
      });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const config = useQuery({
    queryKey: ["regua-cobranca-config"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("billing_regua_config_obter");
      if (error) throw error;
      return data as unknown as Config;
    },
  });

  const funil = useQuery({
    queryKey: ["regua-cobranca-funil"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("billing_regua_funil_pos_teste", { _dias: 60 });
      if (error) throw error;
      return data as unknown as Funil;
    },
  });

  const definirWa = useMutation({
    mutationFn: async (ativo: boolean) => {
      const { error } = await supabase.rpc("billing_regua_whatsapp_definir", { _ativo: ativo });
      if (error) throw error;
    },
    onSuccess: (_d, ativo) => {
      toast.success(ativo ? "WhatsApp da régua ligado" : "WhatsApp da régua desligado");
      setConfirmarWa(null);
      qc.invalidateQueries({ queryKey: ["regua-cobranca-config"] });
      qc.invalidateQueries({ queryKey: ["regua-cobranca"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar o WhatsApp da régua"),
  });

  const filtradas = useMemo(() => {
    const s = busca.trim().toLowerCase();
    if (!s) return data;
    return data.filter(
      (r) =>
        (r.empresa ?? "").toLowerCase().includes(s) ||
        r.recipient.toLowerCase().includes(s) ||
        (r.channel === "whatsapp" && /\d{4,}/.test(s) && r.recipient.includes(s.replace(/\D+/g, ""))),
    );
  }, [data, busca]);

  const pausar = useMutation({
    mutationFn: async (args: { subscriptionId: string; until: string | null; motivo: string | null }) => {
      const { error } = await supabase.rpc("billing_dunning_pausar", {
        _subscription_id: args.subscriptionId,
        _until: args.until,
        _motivo: args.motivo,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Régua atualizada");
      setPausando(null);
      setMotivo("");
      qc.invalidateQueries({ queryKey: ["regua-cobranca"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível atualizar a régua"),
  });

  const confirmarPausa = () => {
    if (!pausando?.subscription_id) return;
    const n = Math.max(1, Math.min(180, Number(dias) || 15));
    const until = new Date();
    until.setDate(until.getDate() + n);
    pausar.mutate({
      subscriptionId: pausando.subscription_id,
      until: until.toISOString(),
      motivo: motivo.trim() || null,
    });
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Régua de Cobrança"
        description="Avisos da assinatura e do teste por e-mail e WhatsApp, com pausa por negociação. O e-mail é o canal oficial de notificação."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="h-4 w-4" /> WhatsApp da Régua
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="wa-regua" className="font-medium">
                {config.data?.whatsapp_ativo ? "Ligado" : "Desligado"}
              </Label>
              <Switch
                id="wa-regua"
                checked={!!config.data?.whatsapp_ativo}
                disabled={config.isLoading || definirWa.isPending}
                onCheckedChange={(v) => setConfirmarWa(v)}
              />
            </div>
            <p className="text-muted-foreground">
              Manda os mesmos avisos do e-mail para o WhatsApp do dono e do financeiro, de segunda a
              sexta, das 9h30 às 11h e das 15h às 16h30. A confirmação de pagamento sai todo dia, das 8h às 20h.
            </p>
            {config.data?.atualizado_em ? (
              <p className="text-xs text-muted-foreground">
                Alterado em {dataHora(config.data.atualizado_em)}
                {config.data.atualizado_por ? ` por ${config.data.atualizado_por}` : ""}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pós-teste · últimos {funil.data?.dias ?? 60} dias</CardTitle>
          </CardHeader>
          <CardContent>
            {funil.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : funil.data ? (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {[
                    ["Testes encerrados", funil.data.encerrados],
                    ["Tentativa 1 (D+1)", funil.data.tentativa_1],
                    ["Tentativa 2 (D+4)", funil.data.tentativa_2],
                    ["Tentativa 3 (D+8)", funil.data.tentativa_3],
                    ["Contrataram", funil.data.contrataram],
                  ].map(([r, v]) => (
                    <div key={r as string} className="rounded-md border p-2">
                      <p className="text-xs text-muted-foreground">{r}</p>
                      <p className="text-lg font-semibold">{v as number}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Contrataram sem tentativa: {funil.data.contratou_sem_tentativa} · após a 1ª:{" "}
                  {funil.data.contratou_apos_1} · após a 2ª: {funil.data.contratou_apos_2} · após a 3ª:{" "}
                  {funil.data.contratou_apos_3}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4" /> Envios ({filtradas.length})
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Empresa, e-mail ou número"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="w-full sm:w-64"
            />
            <Select value={canal} onValueChange={setCanal}>
              <SelectTrigger className="w-full sm:w-44" aria-label="Canal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os canais</SelectItem>
                <SelectItem value="email">E-mail</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="min-w-0 flex-1 sm:w-40 sm:flex-none" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="sent">Enviado</SelectItem>
                <SelectItem value="failed">Falhou</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Estágio</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Enviado em</TableHead>
                  <TableHead>Prova de envio</TableHead>
                  <TableHead className="text-right">Régua</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      Carregando…
                    </TableCell>
                  </TableRow>
                ) : filtradas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      Nenhum envio registrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtradas.map((r) => {
                    const pausada = r.pausada_ate && new Date(r.pausada_ate) > new Date();
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.empresa ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {ESTAGIOS[r.stage] ?? r.stage}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {r.channel === "whatsapp" ? (
                            <span className="inline-flex items-center gap-1"><MessageCircle className="h-4 w-4" /> WhatsApp</span>
                          ) : (
                            <span className="inline-flex items-center gap-1"><Mail className="h-4 w-4" /> E-mail</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.channel === "whatsapp" ? formatarWhatsapp(r.recipient) : r.recipient}
                          {r.status === "pending" && r.channel === "whatsapp" ? (
                            <p className="text-xs text-muted-foreground">Agendado para {dataHora(r.scheduled_at)}</p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(r.status) as never}>
                            {STATUS_LABEL[r.status] ?? r.status}
                          </Badge>
                          {r.last_error ? (
                            <p className="mt-1 max-w-[220px] text-xs text-muted-foreground">
                              {r.last_error}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {dataHora(r.sent_at ?? null)}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                          {r.provider_message_id ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {!r.subscription_id ? (
                            "—"
                          ) : pausada ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                pausar.mutate({
                                  subscriptionId: r.subscription_id!,
                                  until: null,
                                  motivo: null,
                                })
                              }
                            >
                              <PlayCircle className="mr-1 h-4 w-4" /> Retomar
                            </Button>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setPausando(r);
                                setDias("15");
                                setMotivo("");
                              }}
                            >
                              <PauseCircle className="mr-1 h-4 w-4" /> Pausar
                            </Button>
                          )}
                          {pausada ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Pausada até {dataHora(r.pausada_ate)}
                            </p>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmarWa !== null} onOpenChange={(o) => !o && setConfirmarWa(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmarWa ? "Ligar o WhatsApp da régua?" : "Desligar o WhatsApp da régua?"}</DialogTitle>
            <DialogDescription>
              {confirmarWa
                ? "A partir da próxima rotina, os clientes reais passam a receber pelo WhatsApp da Aveto 360 os avisos de vencimento, de carência, do fim do teste (D+1, D+4 e D+8) e a confirmação de pagamento. O e-mail continua sendo enviado normalmente."
                : "Os avisos por WhatsApp que ainda não saíram serão cancelados. O e-mail continua funcionando normalmente."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmarWa(null)}>Cancelar</Button>
            <Button
              variant={confirmarWa ? "default" : "destructive"}
              disabled={definirWa.isPending}
              onClick={() => confirmarWa !== null && definirWa.mutate(confirmarWa)}
            >
              {confirmarWa ? "Ligar WhatsApp" : "Desligar WhatsApp"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pausando} onOpenChange={(o) => !o && setPausando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pausar a régua de {pausando?.empresa ?? "—"}</DialogTitle>
            <DialogDescription>
              Durante a pausa, nenhuma mensagem de cobrança é enfileirada para esta assinatura. O
              bloqueio de acesso por inadimplência não é afetado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dias">Pausar por quantos dias?</Label>
              <Input
                id="dias"
                type="number"
                min={1}
                max={180}
                value={dias}
                onChange={(e) => setDias(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="motivo">Motivo da negociação</Label>
              <Input
                id="motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: Parcelamento acordado com o cliente"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPausando(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmarPausa} disabled={pausar.isPending}>
              Pausar régua
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
