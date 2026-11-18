import { describe, expect, it } from "vitest";
import { CONTATOS_VAZIOS, contatosDoCadastro, validarContatosEmpresa } from "./contatosEmpresa";

describe("contatos da empresa", () => {
  it("proprietário nasce sem receber cobranças", () => {
    const r = validarContatosEmpresa({ ...CONTATOS_VAZIOS, proprietarioNome: "Rafael", proprietarioWhatsapp: "(64) 98136-7653" });
    expect(r.ok && r.valor).toMatchObject({ proprietario_whatsapp: "5564981367653", proprietario_recebe_cobranca: false });
  });

  it("ligar o envio ao proprietário exige o WhatsApp dele", () => {
    const r = validarContatosEmpresa({ ...CONTATOS_VAZIOS, proprietarioNome: "Rafael", proprietarioRecebe: true });
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.erros.proprietarioWhatsapp).toBeTruthy();
  });

  it("com a opção ligada e WhatsApp válido, o proprietário passa a receber", () => {
    const r = validarContatosEmpresa({ ...CONTATOS_VAZIOS, proprietarioWhatsapp: "64981367653", proprietarioRecebe: true });
    expect(r.ok && r.valor.proprietario_recebe_cobranca).toBe(true);
  });

  it("e-mail do financeiro inválido é recusado", () => {
    const r = validarContatosEmpresa({ ...CONTATOS_VAZIOS, financeiroEmail: "rh.rancho330" });
    expect(r.ok).toBe(false);
  });

  it("lê o cadastro gravado com o WhatsApp formatado", () => {
    expect(contatosDoCadastro({ proprietario_whatsapp: "5564981367653", proprietario_recebe_cobranca: false }).proprietarioWhatsapp)
      .toBe("(64) 98136-7653");
  });
});
