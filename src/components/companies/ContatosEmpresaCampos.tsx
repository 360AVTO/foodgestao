import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { maskPhone } from "@/lib/phone";
import type { CampoContato, ContatosEmpresaForm } from "@/lib/empresa/contatosEmpresa";

interface Props {
  idPrefix: string;
  valor: ContatosEmpresaForm;
  onChange: (patch: Partial<ContatosEmpresaForm>) => void;
  erros?: Partial<Record<CampoContato, string>>;
  /** Campo de WhatsApp do financeiro (fica na conta de cobrança). */
  whatsappFinanceiro?: ReactNode;
  /** Mostra o bloco do responsável financeiro. */
  comFinanceiro?: boolean;
}

/** Blocos "Proprietário" e "Responsável financeiro" do cadastro da empresa. */
export function ContatosEmpresaCampos({ idPrefix, valor, onChange, erros = {}, whatsappFinanceiro, comFinanceiro = true }: Props) {
  const id = (k: string) => `${idPrefix}-${k}`;
  const erro = (k: CampoContato) =>
    erros[k] ? <p id={id(`${k}-erro`)} role="alert" className="text-xs text-destructive">{erros[k]}</p> : null;
  const aria = (k: CampoContato) => ({
    "aria-invalid": erros[k] ? true : undefined,
    "aria-describedby": erros[k] ? id(`${k}-erro`) : undefined,
  });

  return (
    <div className="space-y-4">
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-xs font-semibold text-muted-foreground">Proprietário (dono do negócio)</legend>
        <p className="text-xs text-muted-foreground">
          Quem é o dono da empresa. Não precisa ter acesso ao sistema.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={id("prop-nome")} className="text-xs font-medium">Nome do proprietário</Label>
            <Input id={id("prop-nome")} value={valor.proprietarioNome} maxLength={120} autoComplete="off"
              onChange={(e) => onChange({ proprietarioNome: e.target.value })} {...aria("proprietarioNome")} />
            {erro("proprietarioNome")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("prop-wa")} className="text-xs font-medium">WhatsApp do proprietário</Label>
            <Input id={id("prop-wa")} value={valor.proprietarioWhatsapp} maxLength={16} inputMode="tel" autoComplete="off"
              placeholder="(00) 90000-0000"
              onChange={(e) => onChange({ proprietarioWhatsapp: maskPhone(e.target.value) })} {...aria("proprietarioWhatsapp")} />
            {erro("proprietarioWhatsapp")}
          </div>
        </div>
        <label htmlFor={id("prop-recebe")} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md bg-muted/40 p-2.5 text-sm">
          <Checkbox id={id("prop-recebe")} className="mt-0.5" checked={valor.proprietarioRecebe}
            onCheckedChange={(v) => onChange({ proprietarioRecebe: v === true })} />
          <span>
            Enviar faturas e cobranças também para o proprietário
            <span className="block text-xs text-muted-foreground">
              Desmarcado, o proprietário não recebe nenhuma mensagem de cobrança.
            </span>
          </span>
        </label>
      </fieldset>

      {comFinanceiro && (
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-xs font-semibold text-muted-foreground">Responsável financeiro / cobrança</legend>
          <p className="text-xs text-muted-foreground">
            Recebe sempre as faturas, links de pagamento e avisos do plano.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={id("fin-nome")} className="text-xs font-medium">Nome do responsável</Label>
              <Input id={id("fin-nome")} value={valor.financeiroNome} maxLength={120} autoComplete="off"
                onChange={(e) => onChange({ financeiroNome: e.target.value })} {...aria("financeiroNome")} />
              {erro("financeiroNome")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={id("fin-email")} className="text-xs font-medium">E-mail do financeiro</Label>
              <Input id={id("fin-email")} type="email" value={valor.financeiroEmail} maxLength={150} autoComplete="off"
                placeholder="financeiro@empresa.com"
                onChange={(e) => onChange({ financeiroEmail: e.target.value })} {...aria("financeiroEmail")} />
              {erro("financeiroEmail")}
            </div>
            {whatsappFinanceiro}
          </div>
        </fieldset>
      )}
    </div>
  );
}
