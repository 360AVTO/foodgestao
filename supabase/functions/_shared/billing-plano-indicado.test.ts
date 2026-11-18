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
  for (const stage of ["trial_d5", "trial_pos_1", "trial_pos_4", "trial_pos_8", "grace_d_menos_3", "grace_d0"]) {
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

// ---------- reta final do teste: 3 dias antes e último dia ----------
const RANCHO = {
  nome: "Gabriel", empresa: "Rancho 330", indicacao: "plano" as const, colaboradores: 47,
  plano: "Pessoas 360° Enterprise", detalhePlano: "R$ 10,00 por colaborador ativo, hoje cerca de R$ 470,00/mês",
  linkPlanos: "https://www.aveto360.com/planos?plano=pessoas-enterprise",
};

Deno.test("aviso de 3 dias: equipe, plano indicado, link direto e resposta na própria conversa", () => {
  const wa = mensagemWhatsapp("trial_d5", { ...RANCHO, diasRestantes: 3, data: "19/11/2026" })!;
  assert(wa.includes("encerra em 3 dias (19/11)"));
  assert(wa.includes("*47 colaboradores ativos*"));
  assert(wa.includes("*Pessoas 360° Enterprise*"));
  assert(wa.includes("👉 https://www.aveto360.com/planos?plano=pessoas-enterprise"));
  assert(wa.includes("seguir com a implantação na sua operação, é só responder esta mensagem"));
  assert(!wa.includes("wa.me"));
});

Deno.test("último dia: aviso de hoje com o plano indicado e o link direto", () => {
  const wa = mensagemWhatsapp("trial_d7", { ...RANCHO, diasRestantes: 0, data: "19/11/2026" })!;
  assert(wa.includes("Hoje é o último dia do teste gratuito da *Rancho 330*"));
  assert(wa.includes("ative o plano *Pessoas 360° Enterprise*"));
  assert(wa.includes("👉 https://www.aveto360.com/planos?plano=pessoas-enterprise"));
  assert(!wa.includes("wa.me"));
  const mail = billingCopy("trial_d7", { ...RANCHO, diasRestantes: 0 });
  assertEquals(mail.subject, "Hoje é o último dia do seu teste do Aveto 360");
});

Deno.test("último dia no fim de semana sai na sexta dizendo quando encerra", () => {
  const wa = mensagemWhatsapp("trial_d7", { ...RANCHO, diasRestantes: 1, data: "21/11/2026" })!;
  assert(wa.includes("encerra amanhã, sábado (21/11)"));
  assert(!wa.includes("Hoje é o último dia"));
});

Deno.test("reta final sob consulta não mostra preço e pede resposta na conversa", () => {
  const d = { empresa: "Rede X", indicacao: "sob_consulta" as const, colaboradores: 18, linkPlanos: "https://www.aveto360.com/planos" };
  for (const stage of ["trial_d5", "trial_d7"]) {
    const wa = mensagemWhatsapp(stage, { ...d, diasRestantes: stage === "trial_d5" ? 3 : 0 })!;
    assert(!wa.includes("R$"), stage);
    assert(wa.includes("é só responder esta mensagem"), stage);
  }
});

Deno.test("nenhum WhatsApp da régua manda o cliente para outro número", () => {
  for (const s of ["trial_d5", "trial_d7", "trial_pos_1", "trial_pos_4", "trial_pos_8", "oferta_plano", "cortesia_encerrada",
    "grace_d_menos_3", "grace_d_menos_1", "grace_d0", "d_mais_1", "d_mais_5", "d_mais_10", "d_mais_20", "d_mais_28"]) {
    assert(!mensagemWhatsapp(s, { ...RANCHO, diasRestantes: 3 })!.includes("wa.me"), s);
  }
});
