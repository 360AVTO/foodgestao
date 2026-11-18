import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Hourglass, MessageCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePlans, MODULE_LABELS, type PlanModule } from "@/hooks/usePlans";
import { formatarWhatsapp, validarWhatsappCobranca } from "@/lib/billing/whatsappCobranca";
import {
  indicarPlanoPessoas, type PlanoComPreco,
} from "../../../supabase/functions/_shared/billing-plano-indicado.ts";
import { prazoDoTeste } from "../../../supabase/functions/_shared/billing-prazo-teste.ts";

type Linha = {
  company_id: string;
  subscription_id: string;
  empresa: string | null;
  modulo: string | null;
  trial_ends_at: string;
  dias_restantes: number;
  colaboradores: number;
  unidades: number;
  contato_nome: string | null;
  contato_telefone: string | null;
  aviso_enviado_em: string | null;
  ultimo_dia_enviado_em: string | null;
};

const quando = (v: string | null) =>
  v ? format(new Date(v), "dd/MM HH:mm", { locale: ptBR }) : null;

/** Testes que encerram nos próximos dias, com a maior equipe primeiro — para o contato da equipe Aveto. */
export function RetaFinalTestesCard() {
  const lista = useQuery({
    queryKey: ["regua-reta-final"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("billing_regua_reta_final", { _dias: 5 });
      if (error) throw error;
      return (data ?? []) as Linha[];
    },
  });
  const planos = usePlans();
  const catalogo = useMemo(
    () => ((planos.data ?? []) as Array<PlanoComPreco & { is_active?: boolean; is_public?: boolean }>)
      .filter((p) => p.module === "pessoas" && p.is_active !== false && p.is_public !== false),
    [planos.data],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Hourglass className="h-4 w-4" /> Testes na reta final
        </CardTitle>
        <Button
          variant="outline" size="sm" aria-label="Atualizar testes na reta final"
          onClick={() => lista.refetch()} disabled={lista.isFetching}
        >
          <RefreshCw className={`h-4 w-4 ${lista.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Testes que encerram nos próximos 5 dias, com a maior equipe primeiro. O cliente recebe um aviso
          3 dias antes e outro no último dia; respostas no WhatsApp chegam à equipe Aveto.
        </p>
        {lista.isLoading ? (
          <p className="text-muted-foreground">Carregando…</p>
        ) : lista.isError ? (
          <p className="text-destructive">Não foi possível carregar os testes na reta final.</p>
        ) : (lista.data ?? []).length === 0 ? (
          <p className="text-muted-foreground">Nenhum teste encerrando nos próximos 5 dias.</p>
        ) : (
          <ul className="space-y-2">
            {(lista.data ?? []).map((r) => {
              const pessoas = r.modulo === "pessoas" || r.modulo === "dp";
              const ind = pessoas && catalogo.length
                ? indicarPlanoPessoas(catalogo, { colaboradores: r.colaboradores, unidades: r.unidades })
                : null;
              const zap = validarWhatsappCobranca(r.contato_telefone);
              const numero = zap.ok ? zap.valor : null;
              const fim = format(new Date(r.trial_ends_at), "dd/MM/yyyy", { locale: ptBR });
              const prazo = prazoDoTeste(r.dias_restantes, fim);
              return (
                <li key={r.subscription_id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{r.empresa ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {MODULE_LABELS[(r.modulo === "dp" ? "pessoas" : r.modulo) as PlanModule] ?? r.modulo} · encerra {prazo}
                      </p>
                    </div>
                    <Badge variant={r.dias_restantes <= 1 ? "destructive" : "secondary"}>
                      {r.dias_restantes === 0 ? "Hoje" : r.dias_restantes === 1 ? "Amanhã" : `${r.dias_restantes} dias`}
                    </Badge>
                  </div>
                  <p className="mt-2">
                    {r.colaboradores} {r.colaboradores === 1 ? "colaborador ativo" : "colaboradores ativos"} ·{" "}
                    {r.unidades} {r.unidades === 1 ? "unidade" : "unidades"}
                  </p>
                  {ind ? (
                    <p className="text-muted-foreground">
                      {ind.tipo === "plano"
                        ? <>Plano indicado: <span className="font-medium text-foreground">{ind.plano}</span> ({ind.detalhePlano})</>
                        : ind.tipo === "sob_consulta" ? "Proposta sob consulta" : "Ainda sem equipe cadastrada"}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Aviso de 3 dias: {quando(r.aviso_enviado_em) ?? "não enviado"}</span>
                    <span>Último dia: {quando(r.ultimo_dia_enviado_em) ?? "não enviado"}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs">
                      {r.contato_nome ?? "Dono sem nome"}
                      {numero ? ` · ${formatarWhatsapp(numero)}` : " · sem WhatsApp"}
                    </span>
                    {numero ? (
                      <Button asChild variant="outline" size="sm">
                        <a href={`https://wa.me/${numero}`} target="_blank" rel="noopener noreferrer">
                          <MessageCircle className="h-4 w-4" /> Chamar
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
