import { describe, expect, it } from "vitest";
import {
  avisoDoModulo, chaveBalao, escolherAviso, linkWhatsappEquipe, mensagemEquipe,
  podeContratarAssinatura, textoAviso, textoPrazo,
} from "../avisoAssinatura";
import type { ModuleAccessV2 } from "@/hooks/useModuleAccess";

const base: ModuleAccessV2 = {
  module: "pessoas", allowed: true, status: "trialing", motivo: null, dias_restantes: 2,
  trial_ends_at: null, grace_ends_at: null, dias_atraso: null, fatura_pendente_id: null, can_export: true, grant: null,
};
// 18/11/2026 10:24 em Brasília
const agora = new Date("2026-11-18T13:24:00Z");

describe("aviso de fim de teste/carência", () => {
  it("Rancho 330: teste que acaba 19/11 às 13h30 de Brasília é 'amanhã', não '2 dias'", () => {
    const av = avisoDoModulo("pessoas", { ...base, trial_ends_at: "2026-11-19T16:30:20Z" }, agora);
    expect(av).toMatchObject({ fase: "reta_final", tipo: "teste", dias: 1 });
    expect(textoPrazo(av!)).toBe("encerra amanhã, quinta-feira (19/11)");
  });

  it("reta final só aparece nos últimos 3 dias", () => {
    expect(avisoDoModulo("pessoas", { ...base, trial_ends_at: "2026-11-21T15:00:00Z" }, agora)?.dias).toBe(3);
    expect(avisoDoModulo("pessoas", { ...base, trial_ends_at: "2026-11-22T15:00:00Z" }, agora)).toBeNull();
  });

  it("Praianos: carência encerrada mostra a data em Brasília (16/11)", () => {
    const av = avisoDoModulo("pessoas", {
      ...base, allowed: false, status: "expired", motivo: "carencia_expirada", grace_ends_at: "2026-11-17T02:59:59Z",
    }, agora);
    expect(av).toMatchObject({ fase: "encerrado", tipo: "carencia" });
    expect(textoAviso(av!, "BAR PRAIANOS LTDA", 45)).toBe(
      "O período de carência do Pessoas 360° na BAR PRAIANOS LTDA encerrou em 16/11. Os cadastros dos 45 colaboradores e todos os dados continuam salvos e seguros.",
    );
  });

  it("bloqueio por atraso ou sem cobertura não abre o balão", () => {
    expect(avisoDoModulo("pessoas", { ...base, allowed: false, motivo: "inadimplente_suspenso" }, agora)).toBeNull();
    expect(avisoDoModulo("pessoas", { ...base, allowed: false, motivo: "sem_cobertura" }, agora)).toBeNull();
  });

  it("encerrado vem antes da reta final", () => {
    const reta = avisoDoModulo("financeiro", { ...base, module: "financeiro", trial_ends_at: "2026-11-18T20:00:00Z" }, agora);
    const fim = avisoDoModulo("pessoas", { ...base, allowed: false, motivo: "trial_expirado", trial_ends_at: "2026-11-15T20:00:00Z" }, agora);
    expect(escolherAviso([reta, fim])?.modulo).toBe("pessoas");
  });

  it("dono e administrador contratam; demais perfis não", () => {
    expect(podeContratarAssinatura({ role: "owner" })).toBe(true);
    expect(podeContratarAssinatura({ role: "admin" })).toBe(true);
    expect(podeContratarAssinatura({ ehDonoEmpresa: true, role: null })).toBe(true);
    expect(podeContratarAssinatura({ role: "member" })).toBe(false);
  });

  it("mensagem para a equipe AVETO leva nome, empresa, equipe e plano", () => {
    const av = avisoDoModulo("pessoas", { ...base, allowed: false, motivo: "carencia_expirada", grace_ends_at: "2026-11-17T02:59:59Z" }, agora)!;
    const txt = mensagemEquipe({ aviso: av, nome: "SAMANTA SOTERO DE SÁ", empresa: "BAR PRAIANOS LTDA", colaboradores: 45, plano: "Pessoas 360° Enterprise" });
    expect(txt).toBe("Olá! Sou Samanta, da BAR PRAIANOS LTDA. O período de carência do Pessoas 360° encerrou em 16/11 (45 colaboradores ativos) e gostaria de falar com a equipe da AVETO para reativar o acesso com o plano Pessoas 360° Enterprise.");
    expect(linkWhatsappEquipe(txt)).toMatch(/^https:\/\/wa\.me\/5562992365959\?text=Ol%C3%A1/);
  });

  it("balão volta a aparecer no dia seguinte", () => {
    const av = avisoDoModulo("pessoas", { ...base, trial_ends_at: "2026-11-19T16:30:20Z" }, agora)!;
    expect(chaveBalao("c1", av, agora)).not.toBe(chaveBalao("c1", av, new Date("2026-11-19T13:00:00Z")));
  });
});
