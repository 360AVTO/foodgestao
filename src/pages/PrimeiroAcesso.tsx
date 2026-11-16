import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";
import { avaliarSenha, mensagemDoServidorDeContas } from "@/lib/security/passwordPolicy";
import { BlocoNovaSenha, focarCampoSenha } from "@/components/auth/BlocoNovaSenha";
import { motivoSenhaPendente } from "@/lib/security/novaSenha";

/** Regra única de senha nova (S3): src/lib/security/passwordPolicy.ts */
const schema = z.object({
  password: z.string().max(200),
  confirm: z.string(),
}).superRefine((d, ctx) => {
  const av = avaliarSenha(d.password);
  if (!av.valida) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: av.mensagem as string });
  }
}).refine((d) => d.password === d.confirm, {
  message: "As senhas não coincidem",
  path: ["confirm"],
});

export default function PrimeiroAcesso() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tentou, setTentou] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let ativo = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!ativo) return;
      if (!data.session) {
        navigate("/login", { replace: true });
        return;
      }
      // Se a senha já foi trocada, esta tela não deve aparecer de novo.
      const { data: estado } = await supabase
        .from("auth_user_security_state")
        .select("must_change_password")
        .eq("user_id", data.session.user.id)
        .maybeSingle();
      if (ativo && estado && estado.must_change_password === false) {
        navigate("/", { replace: true });
      }
    })();
    return () => {
      ativo = false;
    };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (motivoSenhaPendente(password, confirm)) { setTentou(true); focarCampoSenha(); return; }
    const parsed = schema.safeParse({ password, confirm });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      parsed.error.errors.forEach((err) => { if (err.path[0]) fe[err.path[0] as string] = err.message; });
      setErrors(fe);
      return;
    }
    setSubmitting(true);
    try {
      // Troca da senha + baixa da marca de primeiro acesso no servidor (o
      // navegador não pode escrever no estado de segurança).
      const { data: res, error: fnErr } = await supabase.functions.invoke("auth-primeiro-acesso", {
        body: { nova_senha: password },
      });
      if (fnErr || !res?.success) {
        let bruto = (res as { error?: string } | null)?.error ?? "";
        const ctx = (fnErr as { context?: Response } | null)?.context;
        if (!bruto && ctx && typeof ctx.json === "function") {
          bruto = (await ctx.json().catch(() => ({})))?.error ?? "";
        }
        const texto = mensagemDoServidorDeContas(bruto || fnErr?.message || "");
        setErrors({ password: texto });
        toast.error("Não foi possível salvar a senha", { description: texto });
        return;
      }
      toast.success("Senha atualizada!", { description: "Você já pode continuar." });
      navigate("/", { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Helmet><title>Primeiro acesso — Aveto 360</title></Helmet>
      <div className="w-full max-w-md space-y-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar ao site
        </Link>
        <Card className="w-full shadow-lg">
        <CardHeader className="text-center space-y-3">
          <CardTitle className="text-2xl font-bold">Defina sua senha</CardTitle>
          <CardDescription>
            Este é seu primeiro acesso. Escolha uma senha pessoal — a senha provisória não poderá mais ser usada.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <BlocoNovaSenha
              senha={password}
              confirma={confirm}
              onSenhaChange={(v) => { setPassword(v); setErrors({}); }}
              onConfirmaChange={setConfirm}
              erroSenha={errors.password}
              erroConfirma={errors.confirm}
              tentouEnviar={tentou}
            />
            <Button type="submit" className="w-full min-h-11" disabled={submitting}>
              {submitting ? "Salvando..." : "Salvar Nova Senha"}
            </Button>
          </CardContent>
        </form>
        </Card>
      </div>
    </div>
  );
}
