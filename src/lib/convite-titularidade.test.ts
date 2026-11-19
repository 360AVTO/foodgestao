import { describe, expect, it } from "vitest";
import { digitosFoneBR, validarTitularidade } from "./convite-titularidade";

describe("titularidade no primeiro acesso", () => {
  it("exige escolher proprietário ou administrador", () => {
    const r = validarTitularidade({});
    expect(r.ok).toBe(false);
    expect(!r.ok && r.campo).toBe("papel");
  });

  it("proprietário não precisa informar outra pessoa", () => {
    const r = validarTitularidade({ papel: "owner", proprietarioNome: "", proprietarioWhatsapp: "" });
    expect(r).toEqual({ ok: true, valor: { papel: "owner", proprietarioNome: null, proprietarioWhatsapp: null, convidarProprietario: false } });
  });

  it("administrador precisa informar o nome do proprietário", () => {
    const r = validarTitularidade({ papel: "admin", proprietarioNome: " ", proprietarioWhatsapp: "62999998888" });
    expect(!r.ok && r.campo).toBe("nome");
  });

  it("administrador precisa informar o WhatsApp do proprietário com DDD", () => {
    const r = validarTitularidade({ papel: "admin", proprietarioNome: "João Silva", proprietarioWhatsapp: "99998888" });
    expect(!r.ok && r.campo).toBe("whatsapp");
  });

  it("WhatsApp do proprietário não pode ser o do próprio gestor", () => {
    const r = validarTitularidade(
      { papel: "admin", proprietarioNome: "João Silva", proprietarioWhatsapp: "(62) 98312-8538" },
      { whatsappGestor: "5562983128538" },
    );
    expect(!r.ok && r.erro).toBe("O WhatsApp do proprietário precisa ser diferente do seu.");
  });

  it("administrador válido convida o proprietário por padrão", () => {
    const r = validarTitularidade({ papel: "admin", proprietarioNome: "  João   Silva ", proprietarioWhatsapp: "+55 (62) 99999-8888" });
    expect(r).toEqual({ ok: true, valor: { papel: "admin", proprietarioNome: "João Silva", proprietarioWhatsapp: "62999998888", convidarProprietario: true } });
  });

  it("administrador pode deixar de enviar o convite ao proprietário", () => {
    const r = validarTitularidade({ papel: "admin", proprietarioNome: "João Silva", proprietarioWhatsapp: "62999998888", convidarProprietario: false });
    expect(r.ok && r.valor.convidarProprietario).toBe(false);
  });

  it("remove o 55 do país", () => {
    expect(digitosFoneBR("5562983128538")).toBe("62983128538");
    expect(digitosFoneBR("6283371426")).toBe("6283371426");
  });
});
