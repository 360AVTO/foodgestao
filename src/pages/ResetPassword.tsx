import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { avaliarSenha, mensagemDoServidorDeContas } from "@/lib/security/passwordPolicy";
import { BlocoNovaSenha, focarCampoSenha } from "@/components/auth/BlocoNovaSenha";
import { motivoSenhaPendente } from "@/lib/security/novaSenha";
import { logAudit } from "@/lib/audit";

const schema = z
  .object({
    // Regra única de senha nova (S3): src/lib/security/passwordPolicy.ts
    password: z.string().max(200),
    confirmPassword: z.string(),
  })
  .superRefine((d, ctx) => {
    const av = avaliarSenha(d.password);
    if (!av.valida) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: av.mensagem as string });
    }
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "As senhas não coincidem",
    path: ["confirmPassword"],
  });

export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    // Supabase emits PASSWORD_RECOVERY when user lands from a recovery link.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setHasRecoverySession(true);
      }
      setReady(true);
    });

    // Fallback: a session may already exist when the listener subscribes.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setHasRecoverySession(true);
      setReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (motivoSenhaPendente(password, confirmPassword)) { setTentou(true); focarCampoSenha(); return; }
    const parsed = schema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      parsed.error.errors.forEach((err) => {
        if (err.path[0]) fieldErrors[err.path[0] as string] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      // Só erros de senha ganham tradução; expiração de link e outras falhas
      // seguem com a mensagem original, para não mascarar a causa.
      const bruto = error.message ?? "";
      const ehErroDeSenha = /password|weak|pwned|leaked|compromised|known to be/i.test(bruto);
      const descricao = ehErroDeSenha ? mensagemDoServidorDeContas(bruto) : bruto;
      if (ehErroDeSenha) setErrors({ password: descricao });
      toast.error("Erro ao redefinir senha", { description: descricao });
      return;
    }
    toast.success("Senha redefinida com sucesso");
    await logAudit("user_password_changed", "auth");
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center space-y-3">
          <CardTitle className="text-2xl font-bold">Aveto 360</CardTitle>
          <CardDescription>Defina uma nova senha</CardDescription>
        </CardHeader>

        {!ready ? (
          <CardContent className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Carregando...
          </CardContent>
        ) : !hasRecoverySession ? (
          <>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                O link de redefinição é inválido ou expirou. Solicite um novo a partir da tela de
                login.
              </p>
            </CardContent>
            <CardFooter>
              <Button className="w-full min-h-11" onClick={() => navigate("/login", { replace: true })}>
                Voltar para o Login
              </Button>
            </CardFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4">
              <BlocoNovaSenha
                senha={password}
                confirma={confirmPassword}
                onSenhaChange={(v) => { setPassword(v); setErrors({}); }}
                onConfirmaChange={setConfirmPassword}
                erroSenha={errors.password}
                erroConfirma={errors.confirmPassword}
                tentouEnviar={tentou}
                autoFocus
              />
            </CardContent>

            <CardFooter>
              <Button type="submit" className="w-full min-h-11" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Redefinir Senha
              </Button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}
