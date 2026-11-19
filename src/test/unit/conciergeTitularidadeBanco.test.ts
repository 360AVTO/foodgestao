// @vitest-environment node
import { readFileSync } from "node:fs";
import { Blob as NodeBlob } from "node:buffer";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

const db = new PGlite({ fsBundle: new NodeBlob([readFileSync("node_modules/@electric-sql/pglite/dist/pglite.data")]) as unknown as Blob });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AVETO = id(1), GESTOR = id(2), DONO = id(3), EMPRESA = id(10), GRUPO = id(40), CONVITE = id(41);

beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
  CREATE TYPE company_role AS ENUM ('owner','admin','member','viewer');
  CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('app.actor',true),'')::uuid $$;
  CREATE FUNCTION public.is_super_admin(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u='${AVETO}'::uuid $$;
  CREATE FUNCTION public.tem_permissao(c uuid, i text, n text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
  CREATE TABLE concierge_provisionamentos(company_id uuid PRIMARY KEY, invite_id uuid, invite_grupo_id uuid, gestor_nome text, gestor_email text,
    gestor_whatsapp text, modulos text[], conta_existente boolean DEFAULT false, criado_por uuid, criado_em timestamptz DEFAULT now(), modo text DEFAULT 'convite',
    ativado_em timestamptz, ativado_user_id uuid);
  CREATE TABLE companies(id uuid PRIMARY KEY, user_id uuid, name text, trade_name text, phone text, whatsapp text, timezone text,
    cnpj text, cep text, logradouro text, numero text, complemento text, bairro text, cidade text, uf text,
    trial_iniciado_em timestamptz, trial_termina_em timestamptz, proprietario_nome text, proprietario_whatsapp text);
  CREATE TABLE company_modules(company_id uuid, status text, starts_at timestamptz, ends_at timestamptz, trial_iniciado_em timestamptz, trial_termina_em timestamptz);
  CREATE TABLE company_members(company_id uuid, user_id uuid, role company_role, perfil text, situacao text DEFAULT 'ativo');
  CREATE TABLE profiles(user_id uuid, phone text, full_name text, created_at timestamptz DEFAULT now(), onboarding_completed boolean, profile_type text);
  CREATE TABLE system_parameters(key text, value jsonb);
  CREATE TABLE plans(id uuid, slug text, is_active boolean);
  CREATE TABLE subscriptions(id uuid DEFAULT gen_random_uuid(), user_id uuid, plan_id uuid, module text, status text, trial_ends_at timestamptz,
    current_period_end timestamptz, billing_account_id uuid, created_at timestamptz DEFAULT now());
  CREATE TABLE trial_usage(titular_user_id uuid, email text, module text, plan_id uuid, subscription_id uuid, origem text, started_at timestamptz, ends_at timestamptz);
  CREATE TABLE subscription_companies(subscription_id uuid, company_id uuid, module text, removed_at timestamptz);
  CREATE TABLE company_invites(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, invited_email text, role company_role, invited_by uuid,
    full_name text, whatsapp text, perfil text, modulos jsonb, expires_at timestamptz, grupo_id uuid DEFAULT gen_random_uuid(),
    token text DEFAULT md5(random()::text), status text DEFAULT 'pending');
  CREATE TABLE dp_unidades(id uuid DEFAULT gen_random_uuid(), company_id uuid, nome text, cnpj text, cep text, logradouro text, numero text,
    complemento text, bairro text, cidade text, uf text, telefone text, timezone text, endereco text, created_at timestamptz DEFAULT now());
  CREATE TABLE dp_ficha_importacoes(id uuid, company_id uuid, organizacao jsonb);
  CREATE TABLE dp_ficha_importacao_itens(importacao_id uuid, status text);
  CREATE TABLE dp_notificacoes(id uuid DEFAULT gen_random_uuid(), company_id uuid, user_id uuid, tipo text, titulo text, descricao text, ref_table text, ref_id uuid, para_admins boolean);
  CREATE FUNCTION billing_v2_user_empty_account(u uuid, b boolean) RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;`);
  await db.exec(["0256_titularidade_ativacao_concierge.sql", "0257_concierge_ativar_corrige_modulos.sql"].map((f) => readFileSync(`drizzle/migrations/${f}`, "utf8")).join("\n").replace(/--> statement-breakpoint/g, ""));
}, 30000);
afterAll(() => db.close());

async function preparar() {
  await db.exec(`TRUNCATE dp_ficha_importacoes, dp_ficha_importacao_itens, concierge_provisionamentos, companies, company_modules, company_members, profiles, company_invites, subscriptions, trial_usage, subscription_companies, dp_unidades, dp_notificacoes;
  RESET app.actor;
  INSERT INTO auth.users VALUES ('${GESTOR}','wa62983128538@usuarios.aveto360.local') ON CONFLICT DO NOTHING;
  INSERT INTO auth.users VALUES ('${DONO}','wa62999998888@usuarios.aveto360.local') ON CONFLICT DO NOTHING;
  INSERT INTO companies(id,user_id,name,trade_name,phone,whatsapp) VALUES ('${EMPRESA}','${AVETO}','STAFF LTDA','STAFF','(62) 3333-4444','62983128538');
  INSERT INTO company_invites(id,company_id,role,invited_by,full_name,whatsapp,perfil,modulos,expires_at,grupo_id)
    VALUES ('${CONVITE}','${EMPRESA}','admin','${AVETO}','RICHARD','62983128538','administrador','{"conta":true,"pessoas":true}',now()+interval '15 days','${GRUPO}');
  INSERT INTO concierge_provisionamentos(company_id,invite_id,invite_grupo_id,gestor_nome,gestor_whatsapp,modulos,criado_por)
    VALUES ('${EMPRESA}','${CONVITE}','${GRUPO}','Richard Santos','62983128538',ARRAY['dp'],'${AVETO}');
  INSERT INTO company_members(company_id,user_id,role,perfil) VALUES ('${EMPRESA}','${AVETO}','owner','dono'),('${EMPRESA}','${GESTOR}','admin','administrador');
  INSERT INTO profiles(user_id, phone) VALUES ('${GESTOR}','62983128538'),('${DONO}','62999998888');`);
}
const ativar = (papel: string | null, nome: string | null, wa: string | null, convidar: boolean) =>
  db.query<{ r: Record<string, unknown> }>(`select concierge_ativar('${GRUPO}','${GESTOR}',$1,$2,$3,$4) r`, [papel, nome, wa, convidar]);
const membro = async (u: string) => (await db.query<{ role: string; perfil: string }>(`select role::text, perfil from company_members where user_id='${u}'`)).rows[0];

describe.sequential("Titularidade no primeiro acesso", () => {
  it("gestor que se declara proprietário vira Dono e titular", async () => {
    await preparar();
    await ativar("owner", null, null, false);
    expect(await membro(GESTOR)).toEqual({ role: "owner", perfil: "dono" });
    const c = (await db.query<{ user_id: string; proprietario_whatsapp: string }>("select user_id::text, proprietario_whatsapp from companies")).rows[0];
    expect(c).toEqual({ user_id: GESTOR, proprietario_whatsapp: "5562983128538" });
  });

  it("gestor administrador fica Administrador e grava o proprietário informado", async () => {
    await preparar();
    const r = (await ativar("admin", "João Silva", "(62) 99999-8888", true)).rows[0].r as { proprietario_convite: { whatsapp: string } };
    expect(await membro(GESTOR)).toEqual({ role: "admin", perfil: "administrador" });
    const c = (await db.query("select proprietario_nome, proprietario_whatsapp from companies")).rows[0];
    expect(c).toEqual({ proprietario_nome: "JOÃO SILVA", proprietario_whatsapp: "5562999998888" });
    expect(r.proprietario_convite.whatsapp).toBe("62999998888");
    const conv = (await db.query("select role::text, perfil, whatsapp from company_invites where role='owner'")).rows;
    expect(conv).toEqual([{ role: "owner", perfil: "dono", whatsapp: "62999998888" }]);
  });

  it("administrador sem convite ao proprietário não cria convite de Dono", async () => {
    await preparar();
    const r = (await ativar("admin", "João Silva", "62999998888", false)).rows[0].r as { proprietario_convite: unknown };
    expect(r.proprietario_convite).toBeNull();
    expect((await db.query("select 1 from company_invites where role='owner'")).rows).toHaveLength(0);
  });

  it("recusa administrador sem o WhatsApp do proprietário", async () => {
    await preparar();
    await expect(ativar("admin", "João Silva", "9999", true)).rejects.toThrow("proprietario_whatsapp_invalido");
  });

  it("recusa o WhatsApp do próprio gestor como proprietário", async () => {
    await preparar();
    await expect(ativar("admin", "João Silva", "5562983128538", true)).rejects.toThrow("proprietario_igual_gestor");
  });

  it("proprietário que aceita o convite assume a titularidade como Dono", async () => {
    await preparar();
    const r = (await ativar("admin", "João Silva", "62999998888", true)).rows[0].r as { proprietario_convite: { token: string } };
    const g = (await db.query<{ grupo_id: string }>(`select grupo_id::text from company_invites where token=$1`, [r.proprietario_convite.token])).rows[0].grupo_id;
    await db.exec(`INSERT INTO company_members(company_id,user_id,role,perfil) VALUES ('${EMPRESA}','${DONO}','owner','dono')`);
    await db.query(`select concierge_ativar('${g}','${DONO}')`);
    expect((await db.query("select user_id::text from companies")).rows[0]).toEqual({ user_id: DONO });
    expect(await membro(GESTOR)).toEqual({ role: "admin", perfil: "administrador" });
  });

  it("sem escolha (tela antiga) mantém o gestor como Dono", async () => {
    await preparar();
    await db.query(`select concierge_ativar('${GRUPO}','${GESTOR}')`);
    expect(await membro(GESTOR)).toEqual({ role: "owner", perfil: "dono" });
  });

  it("primeira loja não recebe o WhatsApp pessoal guardado na empresa", async () => {
    await preparar();
    await db.exec(`UPDATE companies SET phone = NULL; SET app.actor='${AVETO}'`);
    await db.query(`select dp_criar_unidade_inicial('${EMPRESA}')`);
    expect((await db.query("select telefone from dp_unidades")).rows).toEqual([{ telefone: null }]);
  });

  it("lote lista o gestor que ainda não criou a senha e registra o aviso para ele", async () => {
    await preparar();
    await db.exec(`DELETE FROM company_members WHERE user_id='${GESTOR}';
      INSERT INTO dp_ficha_importacoes VALUES ('${id(50)}','${EMPRESA}','{}');
      INSERT INTO dp_ficha_importacao_itens VALUES ('${id(50)}','pendente'),('${id(50)}','revisar');
      SET app.actor='${AVETO}'`);
    const lista = (await db.query(`select nome, perfil, invite_id::text, pendente from dp_ficha_lote_responsaveis('${id(50)}')`)).rows;
    expect(lista).toEqual([{ nome: "Richard Santos", perfil: "convite", invite_id: CONVITE, pendente: true }]);
    const r = (await db.query<{ r: { fichas: number } }>(`select dp_ficha_lote_notificar_convite('${id(50)}','${CONVITE}') r`)).rows[0].r;
    expect(r.fichas).toBe(2);
    expect((await db.query("select user_id, para_admins from dp_notificacoes")).rows).toEqual([{ user_id: null, para_admins: true }]);
  });

  it("aviso por convite recusa gestor que já ativou o acesso", async () => {
    await preparar();
    await db.exec(`UPDATE concierge_provisionamentos SET ativado_em = now();
      INSERT INTO dp_ficha_importacoes VALUES ('${id(50)}','${EMPRESA}','{}');
      INSERT INTO dp_ficha_importacao_itens VALUES ('${id(50)}','pendente');
      SET app.actor='${AVETO}'`);
    await expect(db.query(`select dp_ficha_lote_notificar_convite('${id(50)}','${CONVITE}')`)).rejects.toThrow("CONVITE_INVALIDO");
  });
});
