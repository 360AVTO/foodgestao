import { useState } from "react";
import { AlertCircle, Eye, EyeOff, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MedidorSenha } from "@/components/auth/MedidorSenha";
import { ChecklistRequisitosSenha } from "@/components/auth/ChecklistRequisitosSenha";
import { ConferenciaSenhas } from "@/components/auth/ConferenciaSenhas";
import { motivoSenhaPendente, type DadosPessoaisSenha } from "@/lib/security/novaSenha";
import { SENHA_MAX_BYTES } from "@/lib/security/passwordPolicy";

interface Props {
  senha: string;
  confirma: string;
  onSenhaChange: (v: string) => void;
  onConfirmaChange: (v: string) => void;
  /** Nome, e-mail e CPF que não podem aparecer na senha. */
  dados?: DadosPessoaisSenha;
  rotuloSenha?: string;
  rotuloConfirma?: string;
  /** Recusa devolvida pelo servidor, mostrada junto do campo. */
  erroSenha?: string | null;
  erroConfirma?: string | null;
  /** Depois de tentar salvar, mostra o motivo pelo qual ainda não dá. */
  tentouEnviar?: boolean;
  mostrarDica?: boolean;
  autoFocus?: boolean;
  /** Prefixo dos ids; use `idCampoSenha(prefixo)` para focar o campo. */
  idPrefixo?: string;
}

export const idCampoSenha = (prefixo = "nova-senha") => `${prefixo}-campo`;

/** Foca o campo da senha nova (usado quando a pessoa tenta salvar antes da hora). */
export function focarCampoSenha(prefixo = "nova-senha") {
  if (typeof document === "undefined") return;
  document.getElementById(idCampoSenha(prefixo))?.focus();
}

function CampoSenha({
  id, rotulo, valor, onChange, autoFocus, describedBy, invalido,
}: {
  id: string; rotulo: string; valor: string; onChange: (v: string) => void;
  autoFocus?: boolean; describedBy?: string; invalido?: boolean;
}) {
  const [mostrar, setMostrar] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{rotulo}</Label>
      <div className="relative">
        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          id={id}
          type={mostrar ? "text" : "password"}
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 pl-10 pr-11"
          maxLength={SENHA_MAX_BYTES}
          autoFocus={autoFocus}
          aria-describedby={describedBy}
          aria-invalid={invalido || undefined}
        />
        <button
          type="button"
          // Não rouba o foco do campo: o teclado do celular continua aberto.
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => setMostrar((v) => !v)}
          className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={mostrar}
        >
          {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

/**
 * Bloco único de criação de senha (convite, redefinição, ativação do portal,
 * primeiro acesso, recuperação por WhatsApp e candidato). Mesma experiência em
 * todas as telas: olhinho nos dois campos, força, checklist que acende em
 * verde, conferência da confirmação e o motivo quando a pessoa tenta salvar
 * antes da hora. Toda a avaliação é local.
 */
export function BlocoNovaSenha({
  senha, confirma, onSenhaChange, onConfirmaChange, dados,
  rotuloSenha = "Nova senha", rotuloConfirma = "Confirmar nova senha",
  erroSenha, erroConfirma, tentouEnviar = false, mostrarDica = true, autoFocus, idPrefixo = "nova-senha",
}: Props) {
  const idSenha = idCampoSenha(idPrefixo);
  const idConfirma = `${idPrefixo}-confirma`;
  const idRequisitos = `${idPrefixo}-requisitos`;
  const motivo = motivoSenhaPendente(senha, confirma, dados);
  const mostrarMotivo = tentouEnviar && !!motivo;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <CampoSenha
          id={idSenha}
          rotulo={rotuloSenha}
          valor={senha}
          onChange={onSenhaChange}
          autoFocus={autoFocus}
          describedBy={idRequisitos}
          invalido={!!erroSenha}
        />
        {erroSenha && <p role="alert" className="text-xs text-destructive">{erroSenha}</p>}
        <MedidorSenha senha={senha} dados={dados} semMensagem />
        <ChecklistRequisitosSenha senha={senha} dados={dados} mostrarDica={mostrarDica} id={idRequisitos} />
      </div>

      <div className="space-y-2">
        <CampoSenha
          id={idConfirma}
          rotulo={rotuloConfirma}
          valor={confirma}
          onChange={onConfirmaChange}
          invalido={!!erroConfirma}
        />
        {erroConfirma ? (
          <p role="alert" className="text-xs text-destructive">{erroConfirma}</p>
        ) : (
          <ConferenciaSenhas senha={senha} confirmacao={confirma} />
        )}
      </div>

      {mostrarMotivo && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{motivo}</span>
        </p>
      )}
    </div>
  );
}
