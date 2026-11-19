/**
 * Conferência de certificado consolidado: o navegador só calcula o SHA-256 do
 * PDF escolhido e procura o mesmo resumo no registro gravado pelo servidor.
 * Nada do arquivo é enviado; o resultado nunca vem de dados digitados.
 */
export type CertificadoRegistrado = {
  codigo: string;
  sha256: string;
  gerado_em: string;
  paginas: number | null;
  documento: { titulo: string | null } | null;
};

export type ResultadoConferencia =
  | { estado: "autentico"; registro: CertificadoRegistrado }
  | { estado: "nao_encontrado" };

export async function sha256DoArquivo(arquivo: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await arquivo.arrayBuffer());
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Autêntico só quando a impressão digital é idêntica à registrada. */
export function conferirCertificado(sha256: string, registros: CertificadoRegistrado[]): ResultadoConferencia {
  const alvo = sha256.trim().toLowerCase();
  const achado = registros.find((r) => r.sha256.toLowerCase() === alvo);
  return achado ? { estado: "autentico", registro: achado } : { estado: "nao_encontrado" };
}
