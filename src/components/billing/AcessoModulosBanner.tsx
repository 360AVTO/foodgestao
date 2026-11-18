import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCompanyEntitlements, MODULO_ROTULO, type ModuloAcesso } from "@/hooks/useModuleAccess";
import type { useAvisoAssinatura } from "@/hooks/useAvisoAssinatura";
import { textoFaixaAviso } from "@/lib/billing/avisoAssinatura";
import { linkContratacao } from "@/components/billing/AvisoAssinaturaDialog";

type AvisoTopo = ReturnType<typeof useAvisoAssinatura>;
type Linha = { m: ModuloAcesso; texto: string; to: string | null; cta: string; detalhes?: () => void };

/**
 * Modelo v2: uma linha por módulo com teste acabando ou fatura em atraso.
 * Na reta final do teste, a linha vira o atalho do balão (plano indicado, contratar e "Ver detalhes"),
 * para o gestor contratar depois de ter fechado o balão do dia.
 */
export function AcessoModulosBanner({ avisoAssinatura }: { avisoAssinatura?: AvisoTopo } = {}) {
  const { data } = useCompanyEntitlements();
  if (data?.mode !== "v2") return null;

  const linhas = (["financeiro", "pessoas"] as ModuloAcesso[]).flatMap((m): Linha[] => {
    const a = data[m];
    if (!a?.allowed) return [];
    if (a.dias_atraso && a.dias_atraso > 0) {
      const r = Math.max(0, 10 - a.dias_atraso);
      return [{ m, texto: `${MODULO_ROTULO[m]}: mensalidade vencida há ${a.dias_atraso} ${a.dias_atraso === 1 ? "dia" : "dias"}. Suspensão em ${r} ${r === 1 ? "dia" : "dias"}.`,
        to: a.fatura_pendente_id ? `/checkout/pagamento/${a.fatura_pendente_id}` : "/assinatura", cta: "Regularizar" }];
    }
    const av = avisoAssinatura?.aviso;
    if (av && av.modulo === m && av.fase === "reta_final" && av.tipo === "teste" && avisoAssinatura?.resumo) {
      const { resumo, indicacao } = avisoAssinatura;
      const plano = indicacao?.tipo === "plano" ? indicacao.plano : null;
      return [{
        m,
        texto: textoFaixaAviso(av, resumo.colaboradores, plano),
        to: resumo.pode_contratar ? linkContratacao(av, indicacao) : null,
        cta: "Contratar Plano",
        detalhes: avisoAssinatura.abrir,
      }];
    }
    if (a.status === "trialing" && a.dias_restantes != null && a.dias_restantes <= 3) {
      const d = a.dias_restantes;
      const quando = d <= 0 ? "encerra hoje" : d === 1 ? "encerra amanhã" : `encerra em ${d} dias`;
      return [{ m, texto: `${MODULO_ROTULO[m]}: seu período de teste ${quando}.`, to: `/planos?modulo=${m}`, cta: "Assinar Plano" }];
    }
    return [];
  });
  if (!linhas.length) return null;

  return (
    <div className="border-b border-destructive/30 bg-destructive/10">
      {linhas.map((l) => (
        <div key={l.m} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">{l.texto}</span>
          <div className="ml-auto flex items-center gap-1">
            {l.detalhes ? (
              <Button variant="ghost" size="sm" onClick={l.detalhes}>Ver detalhes</Button>
            ) : null}
            {l.to ? <Button asChild size="sm"><Link to={l.to}>{l.cta}</Link></Button> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
