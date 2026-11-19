-- 1) Rastro de rede nas assinaturas de troca de folga (gravado só pelo servidor).
ALTER TABLE public.dp_trocas
  ADD COLUMN IF NOT EXISTS solicitante_ip text,
  ADD COLUMN IF NOT EXISTS solicitante_user_agent text,
  ADD COLUMN IF NOT EXISTS destino_ip text,
  ADD COLUMN IF NOT EXISTS destino_user_agent text;

CREATE OR REPLACE FUNCTION private.dp_req_ip()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  h jsonb;
  v text;
BEGIN
  BEGIN
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF h IS NULL THEN RETURN NULL; END IF;
  v := coalesce(
    nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''),
    nullif(btrim(coalesce(h->>'cf-connecting-ip', '')), ''),
    nullif(btrim(coalesce(h->>'x-real-ip', '')), '')
  );
  IF v IS NULL OR length(v) > 64 OR v !~ '^[0-9A-Fa-f:.]+$' THEN RETURN NULL; END IF;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION private.dp_req_user_agent()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  h jsonb;
BEGIN
  BEGIN
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
  IF h IS NULL THEN RETURN NULL; END IF;
  RETURN nullif(left(btrim(coalesce(h->>'user-agent', '')), 500), '');
END $$;

REVOKE ALL ON FUNCTION private.dp_req_ip() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.dp_req_user_agent() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.dp_req_ip() TO service_role;
GRANT EXECUTE ON FUNCTION private.dp_req_user_agent() TO service_role;

CREATE OR REPLACE FUNCTION public.dp_troca_assinar(p_id uuid, p_assinatura text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_colab uuid;
  t public.dp_trocas%ROWTYPE;
  v_sig text;
  v_ip text := private.dp_req_ip();
  v_ua text := private.dp_req_user_agent();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nao_autenticado'; END IF;
  v_sig := regexp_replace(coalesce(p_assinatura,''), '\s', '', 'g');
  IF left(v_sig, 22) <> 'data:image/png;base64,'
     OR length(v_sig) > 2000000 OR substr(v_sig, 23) !~ '^[A-Za-z0-9+/=]+$' THEN
    RAISE EXCEPTION 'assinatura_invalida';
  END IF;
  v_colab := public.dp_colaborador_ativo_of(auth.uid());
  IF v_colab IS NULL THEN RAISE EXCEPTION 'sem_acesso_portal'; END IF;
  SELECT * INTO t FROM public.dp_trocas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'troca_nao_encontrada'; END IF;
  IF t.status IN ('cancelada','expirada','recusada') THEN RAISE EXCEPTION 'troca_nao_pendente'; END IF;
  IF t.solicitante_id = v_colab THEN
    IF t.solicitante_assinatura IS NULL THEN
      UPDATE public.dp_trocas
         SET solicitante_assinatura = v_sig, solicitante_assinado_em = now(),
             solicitante_ip = v_ip, solicitante_user_agent = v_ua
       WHERE id = p_id;
    END IF;
  ELSIF t.destino_id = v_colab THEN
    IF t.status NOT IN ('pendente_colega','aprovada','pendente_gestor') AND t.destino_assinatura IS NULL THEN RAISE EXCEPTION 'troca_nao_pendente'; END IF;
    IF t.destino_assinatura IS NULL THEN
      UPDATE public.dp_trocas
         SET destino_assinatura = v_sig, destino_assinado_em = now(),
             destino_ip = v_ip, destino_user_agent = v_ua
       WHERE id = p_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'troca_de_outro_colaborador';
  END IF;
  RETURN jsonb_build_object('ok', true);
END $function$;

REVOKE ALL ON FUNCTION public.dp_troca_assinar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dp_troca_assinar(uuid, text) TO authenticated, service_role;

-- 2) Registro imutável dos certificados consolidados (código verificador + SHA-256).
CREATE TABLE IF NOT EXISTS public.dp_documento_certificados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  documento_id uuid NOT NULL REFERENCES public.dp_documentos(id) ON DELETE CASCADE,
  aceite_id uuid REFERENCES public.dp_documento_aceites(id) ON DELETE SET NULL,
  codigo text NOT NULL CHECK (codigo ~ '^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  tamanho_bytes integer NOT NULL CHECK (tamanho_bytes > 0),
  paginas integer CHECK (paginas IS NULL OR paginas > 0),
  gerado_por uuid,
  gerado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dp_documento_certificados_codigo_sha_key UNIQUE (codigo, sha256)
);

GRANT SELECT ON public.dp_documento_certificados TO authenticated;
GRANT ALL ON public.dp_documento_certificados TO service_role;

ALTER TABLE public.dp_documento_certificados ENABLE ROW LEVEL SECURITY;

CREATE POLICY dp_doc_certificados_read ON public.dp_documento_certificados
  FOR SELECT TO authenticated
  USING (
    public.tem_permissao(company_id, 'dp.documentos'::text, 'consulta'::text)
    OR private.is_company_admin_or_owner((SELECT auth.uid()), company_id)
  );

CREATE INDEX IF NOT EXISTS dp_documento_certificados_sha_idx ON public.dp_documento_certificados (sha256);
CREATE INDEX IF NOT EXISTS dp_documento_certificados_codigo_idx ON public.dp_documento_certificados (codigo);
CREATE INDEX IF NOT EXISTS dp_documento_certificados_doc_idx ON public.dp_documento_certificados (documento_id);

CREATE OR REPLACE FUNCTION private.dp_documento_certificados_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'certificado_imutavel';
END $$;

DROP TRIGGER IF EXISTS dp_documento_certificados_sem_update ON public.dp_documento_certificados;
CREATE TRIGGER dp_documento_certificados_sem_update
  BEFORE UPDATE ON public.dp_documento_certificados
  FOR EACH ROW EXECUTE FUNCTION private.dp_documento_certificados_imutavel();

COMMENT ON TABLE public.dp_documento_certificados IS
  'Certificados consolidados gerados por dp-documento-certificado: codigo impresso no rodape + SHA-256 do PDF final. Gravacao so pelo servidor; registro imutavel.';