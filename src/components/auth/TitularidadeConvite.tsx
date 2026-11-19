import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { maskPhone } from "@/lib/phone";
import type { EntradaTitularidade } from "@/lib/convite-titularidade";
import { cn } from "@/lib/utils";

export type ErroTitularidade = { campo: "papel" | "nome" | "whatsapp"; erro: string } | null;

interface Props {
  empresa: string;
  valor: EntradaTitularidade;
  onChange: (v: EntradaTitularidade) => void;
  erro: ErroTitularidade;
}

const OPCOES = [
  { valor: "owner", titulo: "Sou sócio / proprietário", detalhe: "Você fica como Dono da conta." },
  { valor: "admin", titulo: "Sou gerente / administrador", detalhe: "Você fica como Administrador e informa quem é o proprietário." },
] as const;

/** Primeiro acesso de empresa preparada pela Aveto: quem é o dono fica definido aqui, sem pendência para depois. */
export function TitularidadeConvite({ empresa, valor, onChange, erro }: Props) {
  const set = (p: Partial<EntradaTitularidade>) => onChange({ ...valor, ...p });
  return (
    <div role="group" aria-labelledby="titular-pergunta" className="space-y-3 rounded-md border p-3">
      <p id="titular-pergunta" className="text-sm font-medium">Qual é a sua atuação na {empresa}?</p>
      <RadioGroup
        value={valor.papel ?? ""}
        onValueChange={(v) => set({ papel: v })}
        aria-invalid={erro?.campo === "papel"}
        className="gap-2"
      >
        {OPCOES.map((o) => (
          <Label
            key={o.valor}
            htmlFor={`titular-${o.valor}`}
            className={cn(
              "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 font-normal",
              valor.papel === o.valor && "border-primary bg-primary/5",
            )}
          >
            <RadioGroupItem id={`titular-${o.valor}`} value={o.valor} className="mt-0.5" />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium text-foreground">{o.titulo}</span>
              <span className="block text-xs text-muted-foreground">{o.detalhe}</span>
            </span>
          </Label>
        ))}
      </RadioGroup>
      {erro?.campo === "papel" && <p className="text-xs text-destructive">{erro.erro}</p>}

      {valor.papel === "admin" && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <Label htmlFor="proprietario-nome">Nome do proprietário *</Label>
            <Input
              id="proprietario-nome"
              autoComplete="off"
              className="h-11"
              value={valor.proprietarioNome ?? ""}
              onChange={(e) => set({ proprietarioNome: e.target.value })}
              aria-invalid={erro?.campo === "nome"}
            />
            {erro?.campo === "nome" && <p className="text-xs text-destructive">{erro.erro}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="proprietario-whatsapp">WhatsApp do proprietário *</Label>
            <Input
              id="proprietario-whatsapp"
              inputMode="tel"
              autoComplete="off"
              className="h-11"
              placeholder="(00) 00000-0000"
              value={valor.proprietarioWhatsapp ?? ""}
              onChange={(e) => set({ proprietarioWhatsapp: maskPhone(e.target.value) })}
              aria-invalid={erro?.campo === "whatsapp"}
            />
            {erro?.campo === "whatsapp" && <p className="text-xs text-destructive">{erro.erro}</p>}
          </div>
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={valor.convidarProprietario !== false}
              onCheckedChange={(v) => set({ convidarProprietario: !!v })}
            />
            <span>
              Enviar agora o convite de acesso ao proprietário
              <span className="block text-xs text-muted-foreground">
                Ele recebe pelo WhatsApp da Aveto 360 o link para assumir como Dono.
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
