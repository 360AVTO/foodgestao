import { describe, it, expect } from "vitest";
import { avisoIdentidadeConvite, mensagemWhatsappConvite, motivoRecusaConvite, rotuloLogin } from "@/lib/convites-identidade";

describe("conferência de identidade do convite", () => {
  it("bloqueia e-mail que pertence a outra pessoa (caso Karen × conta do Rafael)", () => {
    const a = avisoIdentidadeConvite({ situacao: "email_outra_pessoa", conta_nome: "RAFAEL D." }, "KAREN GOMES");
    expect(a?.bloqueia).toBe(true);
    expect(a?.texto).toContain("RAFAEL D.");
    expect(a?.texto).toContain("Karen");
    expect(a?.texto).not.toContain("..");
  });

  it("bloqueia quem já é membro e manda editar na lista", () => {
    const a = avisoIdentidadeConvite({ situacao: "ja_membro", conta_nome: "KAREN G.", membros: [{ empresa: "Pakere Pizzaria", perfil: "administrador" }] }, "KAREN");
    expect(a?.bloqueia).toBe(true);
    expect(a?.texto).toContain("Pakere Pizzaria (Administrador)");
  });

  it("conta existente da mesma pessoa só informa, não bloqueia", () => {
    expect(avisoIdentidadeConvite({ situacao: "conta_existente", conta_nome: "KAREN G." }, "KAREN")?.bloqueia).toBe(false);
  });

  it("WhatsApp em outra conta alerta sem bloquear", () => {
    const a = avisoIdentidadeConvite({ situacao: "whatsapp_em_outra_conta", conta_nome: "KAREN G.", conta_login_mascarado: "ad***@aveto360.com" }, "KAREN");
    expect(a?.bloqueia).toBe(false);
    expect(a?.texto).toContain("ad***@aveto360.com");
  });

  it("pessoa nova não gera aviso", () => {
    expect(avisoIdentidadeConvite({ situacao: "nova" }, "FULANO")).toBeNull();
  });

  it("mensagem do WhatsApp não pede para criar senha quando já há conta", () => {
    expect(mensagemWhatsappConvite("KAREN", "L", true)).not.toContain("Crie sua senha");
    expect(mensagemWhatsappConvite("KAREN", "L", false)).toContain("Crie sua senha");
  });

  it("extrai o motivo da recusa do servidor", () => {
    expect(motivoRecusaConvite("convite_email_outra_pessoa: Este e-mail já pertence a outra pessoa (RAFAEL D.).")).toBe("Este e-mail já pertence a outra pessoa (RAFAEL D.).");
    expect(motivoRecusaConvite("outro erro")).toBeNull();
  });

  it("mostra login por WhatsApp sem o endereço técnico", () => {
    expect(rotuloLogin("wa62992365959@usuarios.aveto360.local")).toBe("WhatsApp com final 5959");
    expect(rotuloLogin("Atendimento@aveto360.com")).toBe("atendimento@aveto360.com");
  });
});
