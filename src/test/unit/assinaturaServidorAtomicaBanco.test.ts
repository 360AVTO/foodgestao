// @vitest-environment node
import { readFileSync } from "node:fs";
import { Blob as NodeBlob } from "node:buffer";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Banco isolado com pessoas fictícias. Regras da assinatura eletrônica:
// - só o servidor registra aceite (o navegador não chama a rotina direto);
// - aceite e imagem da assinatura são gravados juntos (sem imagem, nada grava);
// - ninguém assina antes de aceitar o Termo do Portal vigente;
// - o recibo por link continua abrindo depois de assinado (via quitada).
const MIG_ATOMICA = "drizzle/migrations/0253_assinatura_servidor_atomica.sql";
const MIG_FECHAR = "drizzle/migrations/0254_fechar_aceite_direto.sql";
const db = new PGlite({ fsBundle: new NodeBlob([readFileSync("node_modules/@electric-sql/pglite/dist/pglite.data")]) as unknown as Blob });

const empresa = "70000000-0000-4000-8000-000000000001";
const colab = (n: number) => `71000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const user = (n: number) => `72000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const doc = (n: number) => `73000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const recibo = "74000000-0000-4000-8000-000000000001";
const HASH = "b".repeat(64);
const IMG = "data:image/png;base64,iVBORw0KGgo=";

async function comoServidor(sim: boolean) {
  await db.query(`SELECT set_config('test.role', $1, false)`, [sim ? "service_role" : "authenticated"]);
}
async function erroDe(sql: string, params: unknown[] = []) {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return String((e as Error).message);
  }
}
const aceitar = (n: number, img: string | null = IMG, termo: string | null = "v2") =>
  erroDe(`SELECT public.dp_documento_aceitar_servidor($1, $2, $3, $4, 'UA', '1.2.3.4')`, [user(n), doc(n), img, termo]);

beforeAll(async () => {
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    END $$;
    CREATE SCHEMA private;
    CREATE FUNCTION private.dp_doc_service_role() RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT current_setting('test.role', true) = 'service_role' $$;
    CREATE TABLE public.portal_estado(user_id uuid PRIMARY KEY, colaborador_id uuid);
    CREATE FUNCTION public.dp_colaborador_assinatura_of(_user_id uuid) RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT colaborador_id FROM public.portal_estado WHERE user_id = _user_id $$;
    CREATE TABLE public.dp_colaboradores(id uuid PRIMARY KEY, company_id uuid);
    CREATE TABLE public.dp_documentos(
      id uuid PRIMARY KEY, company_id uuid, colaborador_id uuid, tipo text, file_path text,
      arquivo_sha256 text, exige_aceite boolean, ciclo_status text, arquivado_em timestamptz,
      aprovacao_status text, versao int);
    CREATE TABLE public.dp_documento_aceites(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, colaborador_id uuid, documento_id uuid,
      modelo text, modelo_versao text, conteudo_hash text, aceito_por uuid, ip text, user_agent text,
      documento_versao int, hash_origem text, assinatura_imagem text, aceito_em timestamptz DEFAULT now());
    CREATE TABLE public.dp_recibos(
      id uuid PRIMARY KEY, company_id uuid, colaborador_id uuid, documento_id uuid, canal_assinatura text,
      cancelado_em timestamptz, assinado_em timestamptz, assinado_ip text, assinado_user_agent text,
      assinado_hash text, assinado_confirmacao jsonb, assinatura_imagem text, link_token_hash text,
      updated_at timestamptz);
    CREATE FUNCTION public.dp_documento_aceitar(_documento_id uuid, _user_agent text DEFAULT NULL, _ip text DEFAULT NULL)
      RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    GRANT EXECUTE ON FUNCTION public.dp_documento_aceitar(uuid, text, text) TO authenticated;
  `);
  for (const n of [1, 2]) {
    await db.query(`INSERT INTO public.dp_colaboradores VALUES ($1, $2)`, [colab(n), empresa]);
    await db.query(`INSERT INTO public.portal_estado VALUES ($1, $2)`, [user(n), colab(n)]);
    await db.query(
      `INSERT INTO public.dp_documentos VALUES ($1, $2, $3, 'contracheque', 'x.pdf', $4, true, 'ativo', NULL, 'aprovado', 1)`,
      [doc(n), empresa, colab(n), HASH],
    );
  }
  // Colaborador 1 aceitou o termo vigente; o 2 só a versão antiga.
  await db.query(`INSERT INTO public.dp_documento_aceites(company_id, colaborador_id, modelo, modelo_versao) VALUES ($1, $2, 'termo_portal', 'v2')`, [empresa, colab(1)]);
  await db.query(`INSERT INTO public.dp_documento_aceites(company_id, colaborador_id, modelo, modelo_versao) VALUES ($1, $2, 'termo_portal', 'v1')`, [empresa, colab(2)]);
  await db.query(
    `INSERT INTO public.dp_recibos(id, company_id, documento_id, canal_assinatura, link_token_hash) VALUES ($1, $2, NULL, 'whatsapp', 'hash-do-link')`,
    [recibo, empresa],
  );
  await db.exec(readFileSync(MIG_ATOMICA, "utf8"));
  await db.exec(readFileSync(MIG_FECHAR, "utf8"));
});

afterAll(async () => {
  await db.close();
});

describe("assinatura de documentos só pelo servidor", () => {
  it("usuário logado não executa a rotina antiga nem a nova direto do navegador", async () => {
    const { rows } = await db.query<{ antiga: boolean; nova: boolean }>(`
      SELECT has_function_privilege('authenticated', 'public.dp_documento_aceitar(uuid,text,text)', 'EXECUTE') antiga,
             has_function_privilege('authenticated', 'public.dp_documento_aceitar_servidor(uuid,uuid,text,text,text,text)', 'EXECUTE') nova`);
    expect(rows[0]).toEqual({ antiga: false, nova: false });
  });

  it("recusa chamada que não vem do servidor", async () => {
    await comoServidor(false);
    expect(await aceitar(1)).toContain("FORBIDDEN");
  });

  it("sem imagem da assinatura nada é gravado", async () => {
    await comoServidor(true);
    expect(await aceitar(1, null)).toContain("assinatura_ausente");
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int n FROM public.dp_documento_aceites WHERE documento_id = $1`, [doc(1)]);
    expect(rows[0].n).toBe(0);
  });

  it("sem o termo do portal vigente não assina", async () => {
    await comoServidor(true);
    expect(await aceitar(2)).toContain("termo_portal_pendente");
  });

  it("grava aceite e imagem juntos, e repetir não duplica", async () => {
    await comoServidor(true);
    expect(await aceitar(1)).toBeNull();
    expect(await aceitar(1)).toBeNull();
    const { rows } = await db.query<{ n: number; img: string }>(
      `SELECT count(*)::int n, max(assinatura_imagem) img FROM public.dp_documento_aceites WHERE documento_id = $1`, [doc(1)]);
    expect(rows[0]).toEqual({ n: 1, img: IMG });
  });

  it("não assina documento de outra pessoa", async () => {
    await comoServidor(true);
    expect(await erroDe(`SELECT public.dp_documento_aceitar_servidor($1, $2, $3, 'v2')`, [user(1), doc(2), IMG])).toContain("documento_indisponivel");
  });
});

describe("recibo por link", () => {
  const assinarRecibo = (img: string | null) =>
    erroDe(`SELECT public.dp_recibo_assinar_externo($1, $2, '1.2.3.4', 'UA', $3)`, [recibo, HASH, img]);

  it("sem imagem da assinatura o recibo não é assinado", async () => {
    await comoServidor(true);
    expect(await assinarRecibo(null)).toContain("RECIBO_ASSINATURA_AUSENTE");
    const { rows } = await db.query<{ assinado_em: string | null }>(`SELECT assinado_em FROM public.dp_recibos WHERE id = $1`, [recibo]);
    expect(rows[0].assinado_em).toBeNull();
  });

  it("assina com imagem na mesma gravação e o link continua valendo", async () => {
    await comoServidor(true);
    expect(await assinarRecibo(IMG)).toBeNull();
    const { rows } = await db.query<{ img: string; link: string | null; ok: boolean }>(
      `SELECT assinatura_imagem img, link_token_hash link, assinado_em IS NOT NULL ok FROM public.dp_recibos WHERE id = $1`, [recibo]);
    expect(rows[0]).toEqual({ img: IMG, link: "hash-do-link", ok: true });
  });
});
