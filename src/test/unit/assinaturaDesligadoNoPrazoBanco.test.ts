// @vitest-environment node
import { readFileSync } from "node:fs";
import { Blob as NodeBlob } from "node:buffer";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Banco isolado com pessoas fictícias: quem foi desligado e ainda está dentro do
// prazo de acesso ao portal assina os documentos pendentes; acesso encerrado ou
// empresa em modo somente leitura continuam sem assinar.
const MIG = "drizzle/migrations/0242_assinatura_desligado_no_prazo.sql";
const db = new PGlite({ fsBundle: new NodeBlob([readFileSync("node_modules/@electric-sql/pglite/dist/pglite.data")]) as unknown as Blob });

const empresa = "60000000-0000-4000-8000-000000000001";
const colab = (n: number) => `61000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const user = (n: number) => `62000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const doc = (n: number) => `63000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const HASH = "a".repeat(64);

async function como(uid: string) {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid]);
}
async function erroDe(sql: string, params: unknown[] = []) {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return String((e as Error).message);
  }
}

beforeAll(async () => {
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    END $$;
    CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA storage;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;
    CREATE TYPE public.dp_documento_tipo AS ENUM ('contracheque','ponto','disciplinar');
    CREATE TABLE public.portal_estado(user_id uuid PRIMARY KEY, colaborador_id uuid, company_id uuid, estado text);
    CREATE FUNCTION private.dp_portal_decisao(_user_id uuid)
      RETURNS TABLE(estado text, colaborador_id uuid, company_id uuid, acesso_ate date) LANGUAGE sql STABLE AS
      $$ SELECT p.estado, p.colaborador_id, p.company_id, NULL::date FROM public.portal_estado p WHERE p.user_id = _user_id $$;
    CREATE FUNCTION private.is_company_admin_or_owner(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION public.is_super_admin(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION public.try_cast_uuid(text) RETURNS uuid LANGUAGE sql AS $$ SELECT $1::uuid $$;
    CREATE FUNCTION public.dp_colaborador_of(_user_id uuid) RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT d.colaborador_id FROM private.dp_portal_decisao(_user_id) d
         WHERE d.estado IN ('ativo','desligado_no_prazo','empresa_suspensa_leitura','aviso_pos_trabalho') $$;
    CREATE TABLE public.dp_colaboradores(id uuid PRIMARY KEY, company_id uuid);
    CREATE TABLE public.dp_documentos(
      id uuid PRIMARY KEY, company_id uuid, colaborador_id uuid, tipo public.dp_documento_tipo,
      file_path text, comprovante_file_path text, arquivo_sha256 text, exige_aceite boolean,
      ciclo_status text, arquivado_em timestamptz, aprovacao_status text, versao int);
    CREATE TABLE public.dp_documento_aceites(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, colaborador_id uuid, documento_id uuid,
      modelo text, modelo_versao text, conteudo_hash text, aceito_por uuid, ip text, user_agent text,
      documento_versao int, hash_origem text);
    CREATE TABLE storage.objects(bucket_id text, name text);
    CREATE POLICY dp_doc_bucket_read_autorizado ON storage.objects FOR SELECT USING (false);
    CREATE POLICY dp_doc_bucket_legacy_read ON storage.objects FOR SELECT USING (false);
  `);
  const estados = ["ativo", "desligado_no_prazo", "aviso_pos_trabalho", "desligado_expirado", "empresa_suspensa_leitura"];
  for (let i = 0; i < estados.length; i++) {
    const n = i + 1;
    await db.query(`INSERT INTO public.dp_colaboradores VALUES ($1, $2)`, [colab(n), empresa]);
    await db.query(`INSERT INTO public.portal_estado VALUES ($1, $2, $3, $4)`, [user(n), colab(n), empresa, estados[i]]);
    await db.query(
      `INSERT INTO public.dp_documentos VALUES ($1, $2, $3, 'contracheque', $4, NULL, $5, true, 'ativo', NULL, 'aprovado', 1)`,
      [doc(n), empresa, colab(n), `${empresa}/${colab(n)}/cc.pdf`, HASH],
    );
  }
  await db.exec(readFileSync(MIG, "utf8").replace(/--> statement-breakpoint/g, ""));
});

afterAll(async () => {
  await db.close();
});

const assinar = (n: number) => erroDe(`SELECT public.dp_documento_aceitar($1)`, [doc(n)]);

describe("assinatura de documentos por quem foi desligado", () => {
  it("desligado dentro do prazo de acesso assina o documento pendente", async () => {
    await como(user(2));
    expect(await assinar(2)).toBeNull();
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int n FROM public.dp_documento_aceites WHERE documento_id = $1`, [doc(2)]);
    expect(rows[0].n).toBe(1);
  });

  it("aviso prévio depois do último dia trabalhado também assina", async () => {
    await como(user(3));
    expect(await assinar(3)).toBeNull();
  });

  it("vínculo ativo continua assinando", async () => {
    await como(user(1));
    expect(await assinar(1)).toBeNull();
  });

  it("acesso ao portal encerrado não assina", async () => {
    await como(user(4));
    expect(await assinar(4)).toContain("sem_acesso_portal");
  });

  it("empresa em modo somente leitura não assina", async () => {
    await como(user(5));
    expect(await assinar(5)).toContain("sem_acesso_portal");
  });

  it("desligado no prazo não assina documento de outra pessoa", async () => {
    await como(user(2));
    expect(await assinar(1)).toContain("documento_indisponivel");
  });
});
