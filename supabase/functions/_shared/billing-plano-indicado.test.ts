import { assert, assertEquals } from "jsr:@std/assert@1";
import { indicarPlanoPessoas, type PlanoComPreco } from "./billing-plano-indicado.ts";
import { mensagemWhatsapp } from "./billing-whatsapp.ts";
import { billingCopy } from "./transactional-email-templates/billing-copy.ts";

// Catálogo oficial do Pessoas 360° (4/8/18 + Enterprise R$ 10 a partir de 19)
const CATALOGO: PlanoComPreco[] = [
  { slug: "pessoas-essencial", name: "Pessoas 360° Essencial", module: "pessoas", sort_order: 1, price_monthly_cents: 4990, features: { max_collaborators: 4, max_units: 1 } },
  { slug: "pessoas-gestao", name: "Pessoas 360° Gestão", module: "pessoas", sort_order: 2, price_monthly_cents: 8990, features: { max_collaborators: 8, max_units: 2 } },
  { slug: "pessoas-multiempresa", name: "Pessoas 360° Multiempresa", module: "pessoas", sort_order: 3, price_monthly_cents: 18990, features: { max_collaborators: 18, max_units: 3 } },
  { slug: "pessoas-enterprise", name: "Pessoas 360° Enterprise", module: "pessoas", sort_order: 4, price_monthly_cents: 19000, features: { min_collaborators: 19, price_per_collaborator_cents: 1000 } },
];

Deno.test("47 colaboradores ativos: Enterprise a R$ 10 por colaborador, cerca de R$ 470/mês", () => {
  const i = indicarPlanoPessoas(CATALOGO, { colaboradores: 47, unidades: 1 });
  assert(i?.tipo === "plano");
  assertEquals(i.slug, "pessoas-enterprise");
  assertEquals(i.detalhePlano, "R$ 10,00 por colaborador ativo, hoje cerca de R$ 470,00/mês");
  assertEquals(i.linkPlanos, "https://www.aveto360.com/planos?plano=pessoas-enterprise");
});

Deno.test("45 colaboradores ativos: estimativa de R$ 450/mês", () => {
  const i = indicarPlanoPessoas(CATALOGO, { colaboradores: 45, unidades: 1 });
  assert(i?.tipo === "plano");
  assertEquals(i.detalhePlano, "R$ 10,00 por colaborador ativo, hoje cerca de R$ 450,00/mês");
});

Deno.test("equipe que cabe na franquia recebe o menor plano que comporta", () => {
  const g = indicarPlanoPessoas(CATALOGO, { colaboradores: 8, unidades: 2 });
  assert(g?.tipo === "plano");
  assertEquals(g.slug, "pessoas-gestao");
  assertEquals(g.detalhePlano, "R$ 89,90/mês, até 8 colaboradores");
  const m = indicarPlanoPessoas(CATALOGO, { colaboradores: 10, unidades: 1 });
  assert(m?.tipo === "plano");
  assertEquals(m.slug, "pessoas-multiempresa");
});

Deno.test("menos de 19 colaboradores com mais de 3 unidades fica sob consulta", () => {
  assertEquals(indicarPlanoPessoas(CATALOGO, { colaboradores: 18, unidades: 4 })?.tipo, "sob_consulta");
});

Deno.test("sem colaboradores ativos não indica plano nem preço", () => {
  const i = indicarPlanoPessoas(CATALOGO, { colaboradores: 0, unidades: 1 });
  assertEquals(i?.tipo, "sem_equipe");
  const wa = mensagemWhatsapp("trial_d5", { empresa: "X", indicacao: "sem_equipe", colaboradores: 0 })!;
  assert(!wa.includes("R$"));
  assert(wa.includes("Ainda não há colaboradores cadastrados"));
});

Deno.test("lembrete do teste cita a equipe real e o plano indicado no WhatsApp e no e-mail", () => {
  const d = { empresa: "Rancho 330", indicacao: "plano" as const, colaboradores: 47, plano: "Pessoas 360° Enterprise", detalhePlano: "R$ 10,00 por colaborador ativo, hoje cerca de R$ 470,00/mês" };
  for (const stage of ["trial_d5", "trial_d7", "trial_pos_1", "trial_pos_4", "trial_pos_8", "grace_d_menos_3", "grace_d0"]) {
    const wa = mensagemWhatsapp(stage, d)!;
    assert(wa.includes("*47 colaboradores ativos*"), stage);
    assert(wa.includes("*Pessoas 360° Enterprise*"), stage);
    assert(billingCopy(stage, d).paragraphs.some((p) => p.includes("47 colaboradores ativos") && p.includes("Pessoas 360° Enterprise")), stage);
  }
});

Deno.test("sem indicação o lembrete continua sem citar equipe nem plano", () => {
  const wa = mensagemWhatsapp("trial_d5", { empresa: "X" })!;
  assert(!wa.includes("colaboradores ativos"));
  assert(!wa.includes("plano indicado"));
});
