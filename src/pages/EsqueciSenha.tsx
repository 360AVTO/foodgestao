import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { IdCard, ShieldCheck, MessageCircle, ArrowLeft } from "lucide-react";
import { TurnstileWidget } from "@/components/auth/TurnstileWidget";
import { useTurnstileConfig } from "@/hooks/useTurnstileSiteKey";
import { describeTurnstileError, currentHostname } from "@/lib/auth/turnstileErrors";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BlocoNovaSenha, focarCampoSenha } from "@/components/auth/BlocoNovaSenha";
import { motivoSenhaPendente } from "@/lib/security/novaSenha";

type Step = "identify" | "otp" | "password" | "done";

async function mensagemDeErro(err: any, padrao: string): Promise<string> {
  try {
    const corpo = await err?.context?.json?.();
    if (corpo?.code === "invalid_reset" || corpo?.code === "reset_failed")
      return "Sua sessão de criação de senha expirou. Volte e solicite um novo código no WhatsApp.";
    if (typeof corpo?.error === "string" && corpo.error) return corpo.error;
  } catch { /* ignora */ }
  const m = String(err?.message ?? "");
  if (/Failed to fetch|NetworkError|Load failed/i.test(m))
    return "Sem conexão com o servidor. Verifique sua internet (Wi-Fi ou dados móveis) e tente de novo.";
  return padrao;
}

export default function EsqueciSenha() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [primeiro, setPrimeiro] = useState(() => searchParams.get("primeiro") === "1");
  const [aviso, setAviso] = useState<string | null>(null);
  const [telefoneMascarado, setTelefoneMascarado] = useState<string | null>(null);
  const { siteKey, mode: turnstileMode } = useTurnstileConfig();

  const [step, setStep] = useState<Step>("identify");
  const [identifier, setIdentifier] = useState(() => (searchParams.get("cpf") ?? "").replace(/\D/g, "").slice(0, 11));
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileError, setTurnstileError] = useState<string | null>(null);
  const [turnstileNonce, setTurnstileNonce] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // OTP state
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Resend control
  const RESEND_COOLDOWN = 60;
  const MAX_RESENDS = 3;
  const [resendIn, setResendIn] = useState(0);
  const [resendAttempts, setResendAttempts] = useState(0);

  // Password reset state
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [tentouSenha, setTentouSenha] = useState(false);

  // OTP expiration countdown
  useEffect(() => {
    if (step !== "otp" || secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [step, secondsLeft]);

  // Resend cooldown countdown
  useEffect(() => {
    if (step !== "otp" || resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [step, resendIn]);

  // Quando o CPF já tem senha, o token anti-robô foi gasto na checagem de
  // primeiro acesso; seguimos a recuperação normal assim que um novo token chegar.
  const [recuperarPendente, setRecuperarPendente] = useState(false);
  useEffect(() => {
    if (!recuperarPendente || !turnstileToken) return;
    setRecuperarPendente(false);
    void pedirRecuperacao(identifier.trim(), turnstileToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recuperarPendente, turnstileToken]);

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!turnstileToken) {
      setAviso("A verificação de segurança (anti-robô) ainda não terminou. Aguarde a caixa de verificação ficar verde e tente de novo.");
      return;
    }
    const raw = identifier.trim();
    setAviso(null);
    const soDigitos = raw.replace(/\D/g, "");
    const pareceCpf = !raw.includes("@") && soDigitos.length === 11;
    if (primeiro || pareceCpf) {
      if (soDigitos.length !== 11) {
        setAviso("Digite os 11 números do seu CPF.");
        return;
      }
      setSubmitting(true);
      let seguirRecuperacao = false;
      try {
        const { data, error } = await supabase.functions.invoke("auth-primeiro-acesso-cpf", {
          body: { cpf: raw, turnstile_token: turnstileToken },
        });
        if (error) {
          let msg = "Não foi possível enviar o código agora. Tente novamente.";
          try { msg = (await (error as any).context?.json())?.error ?? msg; } catch { /* ignora */ }
          setAviso(msg);
          return;
        }
        const mensagens: Record<string, string> = {
          cpf_invalido: "Digite os 11 números do seu CPF.",
          cpf_nao_encontrado:
            "Colaborador não cadastrado. Este CPF ainda não foi registrado pelo Administrador ou Dono da empresa. Confira os 11 números ou peça ao gestor/RH para fazer seu cadastro antes do primeiro acesso.",
          cadastro_removido:
            "Seu cadastro de colaborador foi removido pela empresa. Não é possível ativar o acesso ao portal. Procure o gestor ou RH.",
          sem_modulo_pessoas:
            "Seu cadastro foi localizado, mas sua empresa não tem o módulo Pessoas 360° e o Portal do Colaborador ativos no momento. Procure o Administrador ou Dono da empresa.",
          acesso_bloqueado:
            "Seu acesso ao Portal do Colaborador está bloqueado pela empresa. Procure o gestor ou RH para reativar.",
          vinculo_encerrado:
            "Seu vínculo com a empresa foi encerrado e o prazo de consulta ao portal terminou. Procure o gestor ou RH se precisar de algum documento.",
          sem_whatsapp:
            "Seu cadastro foi localizado, mas ainda não possui um número de WhatsApp cadastrado para envio do código de segurança. Solicite ao gestor ou RH da sua empresa a inclusão do seu celular com DDD.",
          ja_possui_senha:
            "Você já criou sua senha. Volte à tela de login e entre com seu CPF e senha. Se não lembrar, use \"Esqueci minha senha\".",
          acesso_indisponivel:
            "O acesso ao portal não está disponível para este cadastro. Procure o gestor ou RH da sua empresa.",
          falha_envio:
            "Não conseguimos enviar o código pelo WhatsApp agora. Tente novamente em alguns minutos ou procure o gestor/RH.",
        };
        if (data?.status === "ja_possui_senha" && !primeiro) {
          seguirRecuperacao = true;
          return;
        }
        if (data?.status !== "enviado") {
          setAviso(mensagens[data?.status] ?? "Não foi possível enviar o código agora.");
          return;
        }
        if (!primeiro) {
          setPrimeiro(true);
          toast.success("Bem-vindo! Este é o seu primeiro acesso", {
            description: "Enviamos um código para o seu WhatsApp para você cadastrar sua senha pessoal.",
          });
        }
        setChallengeId(data.challenge_id);
        setChallengeToken(data.challenge_token);
        setTelefoneMascarado(data.telefone_mascarado ?? null);
        setSecondsLeft(data.expires_in ?? 600);
        setResendIn(RESEND_COOLDOWN);
        setStep("otp");
      } finally {
        setTurnstileToken(null);
        setTurnstileNonce((nonce) => nonce + 1);
        if (seguirRecuperacao) setRecuperarPendente(true);
        else setSubmitting(false);
      }
      return;
    }
    if (raw.length < 3) {
      setAviso("Informe seu e-mail ou CPF para receber o código.");
      return;
    }
    await pedirRecuperacao(raw, turnstileToken);
  }

  async function pedirRecuperacao(raw: string, token: string) {
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("auth-recovery-request", {
        body: { identifier: raw, turnstile_token: token },
      });
      if (error) throw error;
      if (!data?.challenge_id || !data?.challenge_token) {
        setAviso("O servidor não devolveu o código de recuperação. Tente novamente em instantes; se continuar, procure o gestor/RH.");
        return;
      }
      setChallengeId(data.challenge_id);
      setChallengeToken(data.challenge_token);
      setTelefoneMascarado(typeof data.telefone_final === "string" ? data.telefone_final : null);
      setSecondsLeft(data.expires_in ?? 600);
      setResendIn(RESEND_COOLDOWN);
      setStep("otp");
    } catch (err: any) {
      setAviso(await mensagemDeErro(err, "Não foi possível enviar o código agora. Tente novamente."));
    } finally {
      setTurnstileToken(null);
      setTurnstileNonce((nonce) => nonce + 1);
      setSubmitting(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeId || !challengeToken) return;
    if (!/^\d{6}$/.test(otp)) {
      setAviso("Digite os 6 números do código recebido no WhatsApp.");
      return;
    }
    setAviso(null);
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("auth-recovery-verify", {
        body: { challenge_id: challengeId, challenge_token: challengeToken, otp },
      });
      if (error) throw error;
      if (!data?.reset_token) {
        setAviso("O código digitado não confere. Confira a última mensagem do WhatsApp.");
        return;
      }
      setResetToken(data.reset_token);
      setStep("password");
    } catch (err: any) {
      setAviso(await mensagemDeErro(err, "Código inválido ou expirado. Solicite um novo código."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!challengeId || !resetToken) return;
    if (motivoSenhaPendente(newPassword, confirmPassword)) {
      setTentouSenha(true);
      focarCampoSenha();
      return;
    }
    setAviso(null);
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("auth-recovery-reset", {
        body: { challenge_id: challengeId, reset_token: resetToken, new_password: newPassword },
      });
      if (error) throw error;
      if (!data?.ok) {
        setAviso("O servidor não confirmou a nova senha. Solicite um novo código e tente novamente.");
        return;
      }
      setStep("done");
      toast.success("Senha redefinida com sucesso!");
    } catch (err: any) {
      setAviso(await mensagemDeErro(err, "Não foi possível salvar a senha. Solicite um novo código e tente novamente."));
    } finally {
      setSubmitting(false);
    }
  }

  const mmss = `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/30 p-4">
      <Helmet>
        <title>{primeiro ? "Primeiro acesso" : "Recuperar senha"} — Aveto 360</title>
        <meta name="description" content="Recupere o acesso à sua conta Aveto 360 com verificação via WhatsApp." />
      </Helmet>

      <div className="w-full max-w-md space-y-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao site
        </Link>
        <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">{primeiro ? "Primeiro Acesso — Portal do Colaborador" : "Recuperar senha"}</CardTitle>
          <CardDescription>
            {step === "identify" && (primeiro
              ? "Exclusivo para colaboradores cadastrados pela empresa. Digite seu CPF para enviarmos um código de segurança ao WhatsApp da sua ficha."
              : "Digite o e-mail que você usa para entrar (gestores) ou o seu CPF (colaboradores). O código de segurança vai para o WhatsApp da sua conta, não para o e-mail.")}
            {step === "otp" && (primeiro
              ? (telefoneMascarado
                ? `Enviamos um código de 6 dígitos para o WhatsApp com final ${telefoneMascarado}. Digite o código abaixo para criar sua senha.`
                : "Digite o código de 6 dígitos enviado para o WhatsApp cadastrado.")
              : (telefoneMascarado
                ? `Se a conta estiver cadastrada, o código de 6 dígitos foi enviado para o WhatsApp com final ${telefoneMascarado}.`
                : "Se a conta estiver cadastrada, o código de 6 dígitos foi enviado para o WhatsApp da conta."))}
            {step === "password" && "Escolha uma nova senha forte para continuar."}
            {step === "done" && "Tudo pronto! Você já pode entrar com sua nova senha."}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {aviso && step !== "done" && (
            <Alert variant="destructive" className="mb-4" role="alert">
              <AlertDescription className="text-sm space-y-2">
                <p>{aviso}</p>
                {step !== "identify" && (
                  <Button type="button" size="sm" variant="outline" onClick={() => {
                    setAviso(null); setStep("identify"); setOtp(""); setResetToken(null);
                    setChallengeId(null); setChallengeToken(null);
                  }}>
                    Pedir novo código
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
          {step === "identify" && (
            <form onSubmit={handleRequest} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="identifier">{primeiro ? "CPF" : "E-mail de acesso ou CPF"}</Label>
                <div className="relative">
                  <IdCard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="identifier"
                    name="username"
                    autoComplete="username"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={primeiro ? "Apenas números" : "seu@email.com ou 000.000.000-00"}
                    inputMode={primeiro ? "numeric" : undefined}
                    className="pl-10"
                    maxLength={255}
                    autoFocus
                    required
                  />
                </div>
              </div>

              {!primeiro && <Alert>
                <MessageCircle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  O código chega pelo <strong>WhatsApp</strong> cadastrado na sua conta. O e-mail ou CPF serve só para
                  sabermos de quem é a conta. Por segurança, não informamos se o cadastro existe.
                </AlertDescription>
              </Alert>}

              {siteKey && (
                <TurnstileWidget
                  key={turnstileNonce}
                  siteKey={siteKey}
                  onToken={(t) => { setTurnstileToken(t); setTurnstileError(null); }}
                  onExpire={() => setTurnstileToken(null)}
                  onError={(code) => { setTurnstileToken(null); setTurnstileError(code); }}
                  hidden={!!turnstileError}
                />
              )}
              {turnstileMode === "test" && !turnstileError && (
                <p className="text-xs text-muted-foreground">
                  Verificação em modo de teste (ambiente de preview).
                </p>
              )}
              {turnstileError && (() => {
                const info = describeTurnstileError(turnstileError, currentHostname());
                return (
                  <Alert variant="destructive">
                    <AlertDescription className="text-xs space-y-1">
                      <p className="font-medium">{info.title}</p>
                      <p>{info.message}</p>
                      {info.hint && <p>{info.hint}</p>}
                    </AlertDescription>
                  </Alert>
                );
              })()}

              <Button
                type="submit"
                className="w-full"
                disabled={submitting || !turnstileToken || !!turnstileError}
              >
                {submitting ? "Enviando..." : "Enviar código"}
              </Button>
            </form>
          )}

          {step === "otp" && (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="otp">Código de 6 dígitos</Label>
                <Input
                  id="otp"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  className="text-center text-2xl tracking-[0.5em] font-mono"
                  autoFocus
                  required
                />
                <p className="text-xs text-muted-foreground text-center">
                  {secondsLeft > 0 ? `Expira em ${mmss}` : "Código expirado. Solicite novamente."}
                </p>
              </div>

              <Button type="submit" className="w-full" disabled={submitting || secondsLeft === 0 || otp.length !== 6}>
                {submitting ? "Verificando..." : "Verificar código"}
              </Button>

              {!primeiro && (
                <Alert>
                  <MessageCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs space-y-1">
                    <p>
                      {telefoneMascarado
                        ? `Não reconhece o final ${telefoneMascarado} ou o código não chegou em 2 minutos?`
                        : "O código não chegou em 2 minutos?"}{" "}
                      Sua conta pode estar sem o WhatsApp atualizado.
                    </p>
                    <a
                      href={`https://wa.me/5562992365959?text=${encodeURIComponent("Olá! Pedi a recuperação de senha da Aveto 360, mas o código não chegou no meu WhatsApp.")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-primary underline underline-offset-2"
                    >
                      Falar com o suporte da Aveto pelo WhatsApp
                    </a>
                  </AlertDescription>
                </Alert>
              )}

              {resendAttempts < MAX_RESENDS ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={resendIn > 0}
                  onClick={() => {
                    setResendAttempts((n) => n + 1);
                    setOtp("");
                    setChallengeId(null);
                    setChallengeToken(null);
                    setTurnstileToken(null);
                    setSecondsLeft(0);
                    setResendIn(0);
                    setStep("identify");
                    toast.info("Complete a verificação de segurança para reenviar o código.");
                  }}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  {resendIn > 0
                    ? `Reenviar em ${resendIn}s`
                    : `Reenviar código (${MAX_RESENDS - resendAttempts} restantes)`}
                </Button>
              ) : (
                <p className="text-xs text-center text-muted-foreground">
                  Limite de reenvios atingido. Tente novamente em alguns minutos.
                </p>
              )}
            </form>
          )}

          {step === "password" && (
            <form onSubmit={handleReset} className="space-y-4">
              <BlocoNovaSenha
                senha={newPassword}
                confirma={confirmPassword}
                onSenhaChange={setNewPassword}
                onConfirmaChange={setConfirmPassword}
                tentouEnviar={tentouSenha}
                autoFocus
              />

              <Button
                type="submit"
                className="w-full"
                disabled={submitting}
              >
                {submitting ? "Salvando..." : "Salvar senha"}
              </Button>
            </form>
          )}

          {step === "done" && (
            <div className="space-y-4 text-center">
              <div className="flex justify-center">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <ShieldCheck className="h-8 w-8 text-primary" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Sua senha foi atualizada. Faça login com suas novas credenciais.
              </p>
              <Button className="w-full" onClick={() => navigate("/login")}>
                Ir para o login
              </Button>
            </div>
          )}
        </CardContent>

        <CardFooter className="justify-center">
          <Link to="/login" className="text-xs text-muted-foreground hover:text-foreground">
            Voltar ao login
          </Link>
        </CardFooter>
        </Card>
      </div>
    </div>
  );
}
