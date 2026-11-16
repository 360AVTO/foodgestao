import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { BlocoNovaSenha, focarCampoSenha } from "@/components/auth/BlocoNovaSenha";
import { motivoSenhaPendente } from "@/lib/security/novaSenha";
import { INVITE_TOKEN_KEY } from "@/lib/auth/invite";
import { rotuloLogin } from "@/lib/convites-identidade";

type Info = {
  nome: string | null;
  empresas: string[];
  login: "email" | "whatsapp";
  login_hint: string;
  conta_existe: boolean;
  /** Conta exata a que o convite foi vinculado. */
  login_exibicao?: string;
};
type Status = "loading" | "ready" | "criar" | "accepted" | "ja_ativo" | "outra_conta" | "error" | "expired";

/** Recusa do servidor quando o convite é de outra conta (accept-invite 403). */
function outraConta(msg: string): boolean {
  return /enviado para outra pessoa/i.test(msg);
}

/** Convite consumido pela própria pessoa: o acesso já está valendo. */
function jaUtilizado(msg: string): boolean {
  return /não encontrado|nao encontrado|já utilizad|ja utilizad|inválido|invalido|já faz parte|ja faz parte/i.test(msg);
}

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("loading");
  const [info, setInfo] = useState<Info | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [tentou, setTentou] = useState(false);
  const [erroSenha, setErroSenha] = useState<string | null>(null);

  const [infoBuscada, setInfoBuscada] = useState(false);
  const [infoFalhou, setInfoFalhou] = useState<"expired" | "error" | null>(null);

  // Dados do convite (também para quem já está conectado: mostra a conta vinculada).
  useEffect(() => {
    if (!token || infoBuscada) return;
    setInfoBuscada(true);
    (async () => {
      const { data, error } = await supabase.functions.invoke("invite-signup", { body: { action: "info", token } });
      let d = data as any;
      if (error && !d) {
        try { d = await (error as any).context?.json(); } catch { /* sem corpo legível */ }
      }
      if (error || d?.error) {
        const code = d?.code ?? (error as any)?.context?.status;
        setInfoFalhou(code === "expirado" || code === 410 ? "expired" : "error");
        return;
      }
      setInfo(d as Info);
    })();
  }, [token, infoBuscada]);

  useEffect(() => {
    if (authLoading) return;
    // Convite já concluído nesta tela: o login que acabou de acontecer NÃO
    // reabre a conferência do link (ele é de uso único e já foi consumido).
    if (status === "accepted" || status === "ja_ativo" || status === "outra_conta") return;
    if (!token) { setStatus("error"); return; }
    // Conectado: quem decide é o aceite (convite já usado vira "acesso ativo").
    if (user) { setStatus("ready"); return; }
    if (infoFalhou) { setStatus(infoFalhou); return; }
    if (info) setStatus("criar");
  }, [user, authLoading, token, status, info, infoFalhou]);

  const loginVinculado = info?.login_exibicao ?? info?.login_hint ?? "";

  const irParaLogin = () => {
    try { sessionStorage.setItem(INVITE_TOKEN_KEY, token ?? ""); } catch { /* noop */ }
    const l = info?.login === "email" && info?.login_exibicao?.includes("@") ? `?login=${encodeURIComponent(info.login_exibicao)}` : "";
    navigate(`/login${l}`, { replace: true });
  };

  const trocarConta = async () => {
    setBusy(true);
    await supabase.auth.signOut();
    setBusy(false);
    setStatus("loading");
  };

  const handleAccept = async () => {
    if (!user || !token) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("accept-invite", { body: { token } });
    let d = data as any;
    if (error && !d) {
      try { d = await (error as any).context?.json(); } catch { /* sem corpo legível */ }
    }
    const msg = d?.error || error?.message;
    if (msg) {
      if (/expirad|expired/i.test(msg)) setStatus("expired");
      else if (outraConta(msg)) setStatus("outra_conta");
      else if (jaUtilizado(msg)) setStatus("ja_ativo");
      else { setStatus("error"); toast.error("Erro ao aceitar convite", { description: msg }); }
    } else {
      setStatus("accepted");
      setCompanyName((data as any)?.company_name ?? "");
    }
    setBusy(false);
  };


  const dadosSenha = { nome: info?.nome };
  const motivoSenha = motivoSenhaPendente(senha, confirma, dadosSenha);

  const handleCriar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (motivoSenha) { setTentou(true); focarCampoSenha(); return; }
    setErroSenha(null);
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("invite-signup", {
      body: { action: "criar_conta", token, password: senha },
    });
    let d = data as any;
    // Respostas 4xx chegam como exceção: lê o corpo para saber o motivo real.
    if (error && !d) {
      try { d = await (error as any).context?.json(); } catch { /* sem corpo legível */ }
    }
    if (error || d?.error) {
      if (d?.code === "conta_existe") { toast.info(d.error); irParaLogin(); }
      // Recusa da regra de senha (ex.: contém parte do e-mail completo, que a
      // tela não conhece): mostra junto do campo, não só num aviso passageiro.
      else if (d?.code === "senha_fraca") { setErroSenha(d.error); focarCampoSenha(); }
      else toast.error("Não foi possível criar a conta", { description: d?.error ?? "Tente novamente." });
      setBusy(false);
      return;
    }
    const { error: signErr } = await supabase.auth.signInWithPassword({ email: d.login_email, password: senha });
    setBusy(false);
    if (signErr) { toast.success("Conta criada! Entre com sua senha."); navigate("/login"); return; }
    setCompanyName((d.empresas ?? []).join(", "));
    setStatus("accepted");
  };

  if (authLoading || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        {status === "criar" && info && (
          <>
            <CardHeader className="text-center">
              <CardTitle>Bem-vindo{info.nome ? `, ${info.nome.split(" ")[0]}` : ""}!</CardTitle>
              <CardDescription>
                Você foi convidado para acessar {info.empresas.join(", ") || "uma empresa"} no Aveto 360.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {info.conta_existe ? (
                <div className="space-y-4">
                  <div className="rounded-md border bg-muted/40 p-3 text-sm">
                    <p className="text-muted-foreground">Este convite foi vinculado à conta</p>
                    <p className="mt-0.5 break-all font-semibold text-foreground">{loginVinculado}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Entre com a senha que você já usa nessa conta para confirmar o acesso.
                  </p>
                  <Button className="w-full min-h-11" onClick={irParaLogin}>Entrar com esta conta</Button>
                  <Button type="button" variant="ghost" className="w-full min-h-10" onClick={() => navigate("/esqueci-senha")}>
                    Esqueci a senha desta conta
                  </Button>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Não reconhece esta conta? Peça a quem enviou o convite para refazê-lo com o seu e-mail ou só com o seu WhatsApp.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleCriar} className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Seu login será o {info.login === "email" ? "e-mail" : "WhatsApp"} <strong>{info.login_hint}</strong>.
                  </p>
                  <BlocoNovaSenha
                    senha={senha}
                    confirma={confirma}
                    onSenhaChange={(v) => { setSenha(v); setErroSenha(null); }}
                    onConfirmaChange={setConfirma}
                    dados={dadosSenha}
                    rotuloSenha="Crie sua senha"
                    rotuloConfirma="Confirme a senha"
                    erroSenha={erroSenha}
                    tentouEnviar={tentou}
                  />
                  <Button type="submit" className="w-full min-h-11" disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar senha e entrar"}
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={irParaLogin}>Já tenho conta</Button>
                </form>
              )}
            </CardContent>
          </>
        )}

        {status === "ready" && (
          <>
            <CardHeader className="text-center">
              <CardTitle>Convite para Empresa</CardTitle>
              <CardDescription>
                Você recebeu um convite para acessar {info?.empresas?.length ? info.empresas.join(", ") : "uma empresa"} no Aveto 360.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-3">
              {loginVinculado && (
                <div className="w-full rounded-md border bg-muted/40 p-3 text-sm">
                  <p className="text-muted-foreground">Convite vinculado à conta</p>
                  <p className="mt-0.5 break-all font-semibold text-foreground">{loginVinculado}</p>
                </div>
              )}
              <Button onClick={handleAccept} disabled={busy} className="w-full min-h-11">
                {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Aceitando...</> : <><CheckCircle className="h-4 w-4 mr-2" />Aceitar Convite</>}
              </Button>
              <Button variant="outline" onClick={() => navigate("/login")} className="w-full min-h-10">Cancelar</Button>
            </CardContent>
          </>
        )}

        {status === "outra_conta" && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2"><XCircle className="h-12 w-12 text-destructive" /></div>
              <CardTitle>Este convite é de outra conta</CardTitle>
              <CardDescription>Você entrou com uma conta diferente da que recebeu o convite.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-2">
                <div>
                  <p className="text-muted-foreground">Você está conectado como</p>
                  <p className="break-all font-semibold text-foreground">{rotuloLogin(user?.email)}</p>
                </div>
                {loginVinculado && (
                  <div>
                    <p className="text-muted-foreground">O convite foi vinculado à conta</p>
                    <p className="break-all font-semibold text-foreground">{loginVinculado}</p>
                  </div>
                )}
              </div>
              <Button className="w-full min-h-11" onClick={trocarConta} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sair e entrar com a conta do convite"}
              </Button>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Não reconhece a conta do convite? Peça a quem enviou para refazê-lo com o seu e-mail ou só com o seu WhatsApp.
              </p>
            </CardContent>
          </>
        )}

        {status === "accepted" && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2"><CheckCircle className="h-12 w-12 text-primary" /></div>
              <CardTitle>Acesso Liberado!</CardTitle>
              <CardDescription>Você agora faz parte de{companyName ? ` ${companyName}` : " uma empresa"}.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => navigate("/hub")} className="w-full">Começar</Button>
            </CardContent>
          </>
        )}

        {status === "ja_ativo" && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2"><CheckCircle className="h-12 w-12 text-primary" /></div>
              <CardTitle>Seu acesso já está ativo</CardTitle>
              <CardDescription>
                Este convite já foi usado por você. Entre com seu e-mail e a senha que você criou.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => navigate(user ? "/hub" : "/login")} className="w-full">
                {user ? "Acessar o sistema" : "Entrar"}
              </Button>
            </CardContent>
          </>
        )}


        {(status === "expired" || status === "error") && (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2"><XCircle className="h-12 w-12 text-destructive" /></div>
              <CardTitle>{status === "expired" ? "Convite Expirado" : "Convite Inválido"}</CardTitle>
              <CardDescription>
                {status === "expired"
                  ? "Este convite expirou ou já foi utilizado. Peça um novo ao administrador da empresa."
                  : "Não foi possível abrir este convite. Verifique o link ou peça um novo convite."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => navigate("/login")} className="w-full">Voltar ao Início</Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
