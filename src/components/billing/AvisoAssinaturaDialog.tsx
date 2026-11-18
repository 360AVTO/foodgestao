import { Link } from "react-router-dom";
import { Hourglass, MessageCircle, ShieldAlert, Sparkles } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  linkWhatsappEquipe, listaNomes, mensagemEquipe, textoAviso, tituloAviso, type AvisoAssinatura,
} from "@/lib/billing/avisoAssinatura";
import type { ResumoAvisoAssinatura } from "@/hooks/useAvisoAssinatura";
import type { IndicacaoPlano } from "../../../supabase/functions/_shared/billing-plano-indicado.ts";

interface Props {
  aviso: AvisoAssinatura;
  resumo: ResumoAvisoAssinatura | null;
  indicacao: IndicacaoPlano | null;
}

export function linkContratacao(aviso: AvisoAssinatura, indicacao: IndicacaoPlano | null) {
  const base = `/planos?modulo=${aviso.modulo}`;
  return indicacao?.tipo === "plano" ? `${base}&plano=${encodeURIComponent(indicacao.slug)}` : base;
}

/** Selo do plano indicado pelo tamanho da equipe (estimativa; o valor final vem do servidor). */
export function SeloPlanoIndicado({ indicacao }: { indicacao: IndicacaoPlano | null }) {
  if (!indicacao || indicacao.tipo === "sem_equipe") return null;
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
      {indicacao.tipo === "plano" ? (
        <>
          <p className="font-medium text-foreground">Plano indicado: {indicacao.plano}</p>
          <p className="text-muted-foreground">
            Para {indicacao.colaboradores} {indicacao.colaboradores === 1 ? "colaborador ativo" : "colaboradores ativos"}: {indicacao.detalhePlano}.
          </p>
        </>
      ) : (
        <p className="text-muted-foreground">
          Para {indicacao.colaboradores} colaboradores ativos, a proposta é feita sob consulta com a nossa equipe.
        </p>
      )}
    </div>
  );
}

/** Ações do aviso: contratar (dono/administrador), falar com a equipe AVETO e, para os demais, quem procurar. */
export function AcoesAvisoAssinatura({ aviso, resumo, indicacao, onAcao }: Props & { onAcao?: () => void }) {
  const podeContratar = !!resumo?.pode_contratar;
  const plano = indicacao?.tipo === "plano" ? indicacao.plano : null;
  const zap = linkWhatsappEquipe(mensagemEquipe({
    aviso, nome: resumo?.meu_nome, empresa: resumo?.empresa, colaboradores: resumo?.colaboradores, plano,
  }));
  const outros = (resumo?.responsaveis ?? []).filter((n) => n !== resumo?.meu_nome);

  return (
    <div className="space-y-3">
      {!podeContratar && (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">
          A contratação é feita pelo dono ou por um administrador da empresa
          {outros.length ? <>: <span className="font-medium">{listaNomes(outros)}</span></> : null}.
          {aviso.fase === "encerrado" ? " Peça a ativação para liberar o acesso da equipe." : null}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {podeContratar && (
          <Button asChild className="w-full sm:w-auto" onClick={onAcao}>
            <Link to={linkContratacao(aviso, indicacao)}>
              <Sparkles className="mr-2 h-4 w-4" />
              {aviso.fase === "encerrado" ? "Ativar Assinatura" : "Contratar Plano"}
            </Link>
          </Button>
        )}
        <Button asChild variant="outline" className="w-full sm:w-auto" onClick={onAcao}>
          <a href={zap} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="mr-2 h-4 w-4" /> Falar com Nossa Equipe
          </a>
        </Button>
      </div>
    </div>
  );
}

/** Balão ao entrar: reta final (3 dias) ou período encerrado, para quem é da empresa. */
export function AvisoAssinaturaDialog({ aviso, resumo, indicacao, aberto, fechar }: {
  aviso: AvisoAssinatura | null;
  resumo: ResumoAvisoAssinatura | null;
  indicacao: IndicacaoPlano | null;
  aberto: boolean;
  fechar: () => void;
}) {
  if (!aviso) return null;
  const encerrado = aviso.fase === "encerrado";
  const Icone = encerrado ? ShieldAlert : Hourglass;
  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) fechar(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader className="text-left">
          <div>
            <Badge variant={encerrado ? "destructive" : "secondary"} className="mb-1">
              {encerrado ? "Encerrado" : aviso.dias === 0 ? "Último dia" : aviso.dias === 1 ? "Termina amanhã" : `Faltam ${aviso.dias} dias`}
            </Badge>
          </div>
          <DialogTitle className="flex items-center gap-2">
            <Icone className={`h-5 w-5 shrink-0 ${encerrado ? "text-destructive" : "text-primary"}`} aria-hidden="true" />
            {tituloAviso(aviso)}
          </DialogTitle>
          <DialogDescription>{textoAviso(aviso, resumo?.empresa ?? null, resumo?.colaboradores)}</DialogDescription>
        </DialogHeader>

        <SeloPlanoIndicado indicacao={indicacao} />
        <AcoesAvisoAssinatura aviso={aviso} resumo={resumo} indicacao={indicacao} onAcao={fechar} />

        <DialogFooter className="sm:justify-start">
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground sm:w-auto" onClick={fechar}>
            {encerrado ? "Agora Não" : "Continuar Testando"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
