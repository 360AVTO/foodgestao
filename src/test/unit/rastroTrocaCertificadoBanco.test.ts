// @vitest-environment node
import { readFileSync } from "node:fs";
import { Blob as NodeBlob } from "node:buffer";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Banco isolado com pessoas fictícias. Regras:
// - a assinatura da troca guarda IP e aparelho lidos pelo servidor (cabeçalhos da requisição),
//   nunca valores enviados pelo navegador, e não muda depois de assinada;
// - o registro do certificado (código + SHA-256) não pode ser alterado.
const MIG = "drizzle/migrations/0255_rastro_troca_e_certificados.sql";
const db = new PGlite({ fsBundle: new NodeBlob([readFileSync("node_modules/@electric-sql/pglite/dist/pglite.data")]) as unknown as Blob });

const empresa = "80000000-0000-4000-8000-000000000001";
const solicitante = "81000000-0000-4000-8000-000000000001";
const colega = "81000000-0000-4000-8000-000000000002";
const userSol = "82000000-0000-4000-8000-000000000001";
const userCol = "82000000-0000-4000-8000-000000000002";
const troca = "83000000-0000-4000-8000-000000000001";
const IMG = "data:image/png;base64,iVBORw0KGgo=";

async function comoUsuario(uid: string, headers: Record<string, string> | null) {
  await db.query(`SELECT set_config('test.uid', $1, false)`, [uid]);
  await db.query(`SELECT set_config('request.headers', $1, false)`, [headers ? JSON.stringify(headers) : ""]);
}
async function erroDe(sql: string, params: unknown[] = []) {
  try { await db.query(sql, params); return null; } catch (e) { return String((e as Error).message); }
}

beforeAll(async () => {
  await db.exec(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    END $$;
    CREATE SCHEMA private;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    CREATE FUNCTION private.is_company_admin_or_owner(uuid, uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION public.tem_permissao(uuid, text, text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE TABLE public.portal(user_id uuid PRIMARY KEY, colaborador_id uuid);
    CREATE FUNCTION public.dp_colaborador_ativo_of(_u uuid) RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT colaborador_id FROM public.portal WHERE user_id = _u $$;
    CREATE TABLE public.companies(id uuid PRIMARY KEY);
    CREATE TABLE public.dp_documentos(id uuid PRIMARY KEY, company_id uuid);
    CREATE TABLE public.dp_documento_aceites(id uuid PRIMARY KEY);
    CREATE TABLE public.dp_trocas(
      id uuid PRIMARY KEY, company_id uuid, solicitante_id uuid, destino_id uuid, status text,
      solicitante_assinatura text, solicitante_assinado_em timestamptz,
      destino_assinatura text, destino_assinado_em timestamptz);
  `);
  await db.exec(readFileSync(MIG, "utf8"));
  await db.query(`INSERT INTO public.portal VALUES ($1,$2),($3,$4)`, [userSol, solicitante, userCol, colega]);
  await db.query(`INSERT INTO public.companies VALUES ($1)`, [empresa]);
  await db.query(`INSERT INTO public.dp_documentos VALUES ('84000000-0000-4000-8000-000000000001', $1)`, [empresa]);
  await db.query(`INSERT INTO public.dp_trocas(id, company_id, solicitante_id, destino_id, status) VALUES ($1,$2,$3,$4,'pendente_colega')`,
    [troca, empresa, solicitante, colega]);
});
afterAll(async () => { await db.close(); });

describe("rastro da assinatura da troca", () => {
  it("grava o primeiro IP da cadeia e o aparelho lidos pelo servidor", async () => {
    await comoUsuario(userSol, { "x-forwarded-for": "200.10.20.30, 10.0.0.1", "user-agent": "Mozilla/5.0 (Linux; Android 14) Chrome/130" });
    expect(await erroDe(`SELECT public.dp_troca_assinar($1, $2)`, [troca, IMG])).toBeNull();
    const r = await db.query<{ ip: string; ua: string }>(`SELECT solicitante_ip ip, solicitante_user_agent ua FROM public.dp_trocas`);
    expect(r.rows[0]).toEqual({ ip: "200.10.20.30", ua: "Mozilla/5.0 (Linux; Android 14) Chrome/130" });
  });

  it("assinar de novo não troca o IP nem o aparelho já gravados", async () => {
    await comoUsuario(userSol, { "x-forwarded-for": "9.9.9.9", "user-agent": "Outro" });
    await db.query(`SELECT public.dp_troca_assinar($1, $2)`, [troca, IMG]);
    const r = await db.query<{ ip: string }>(`SELECT solicitante_ip ip FROM public.dp_trocas`);
    expect(r.rows[0].ip).toBe("200.10.20.30");
  });

  it("IP com formato inválido não é gravado; sem cabeçalhos a assinatura segue", async () => {
    await comoUsuario(userCol, { "x-forwarded-for": "<script>", "user-agent": "UA colega" });
    expect(await erroDe(`SELECT public.dp_troca_assinar($1, $2)`, [troca, IMG])).toBeNull();
    const r = await db.query<{ ip: string | null; ua: string; a: string }>(`SELECT destino_ip ip, destino_user_agent ua, destino_assinatura a FROM public.dp_trocas`);
    expect(r.rows[0]).toEqual({ ip: null, ua: "UA colega", a: IMG });
  });
});

describe("registro do certificado", () => {
  it("não pode ser alterado depois de gravado", async () => {
    await db.query(`INSERT INTO public.dp_documento_certificados(company_id, documento_id, codigo, sha256, tamanho_bytes)
      VALUES ($1, '84000000-0000-4000-8000-000000000001', 'ABCD-1234-EF56', $2, 1000)`, [empresa, "c".repeat(64)]);
    expect(await erroDe(`UPDATE public.dp_documento_certificados SET sha256 = $1`, ["d".repeat(64)])).toContain("certificado_imutavel");
  });

  it("recusa código fora do formato do rodapé", async () => {
    expect(await erroDe(`INSERT INTO public.dp_documento_certificados(company_id, documento_id, codigo, sha256, tamanho_bytes)
      VALUES ($1, '84000000-0000-4000-8000-000000000001', 'abc', $2, 10)`, [empresa, "e".repeat(64)])).not.toBeNull();
  });
});
