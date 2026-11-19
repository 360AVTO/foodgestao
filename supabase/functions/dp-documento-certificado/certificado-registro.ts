/**
 * Registro do certificado consolidado: o código impresso no rodapé nasce da
 * chave do certificado (antes do PDF existir) e o SHA-256 do arquivo final é
 * gravado junto, só pelo servidor. Conferir um PDF = recalcular o SHA-256 e
 * procurar o mesmo par código/impressão digital.
 */
import { type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { sha256Hex } from "../_shared/doc-hash.ts";
import { recordEdgeError } from "../_shared/error-log.ts";

/** Código curto e estável por versão do certificado (XXXX-XXXX-XXXX). */
export async function codigoCertificado(chave: string): Promise<string> {
  const hex = (await sha256Hex(new TextEncoder().encode(chave).buffer as ArrayBuffer)).slice(0, 12).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

export type RegistroCertificado = {
  companyId: string;
  documentoId: string;
  aceiteId: string | null;
  codigo: string;
  bytes: Uint8Array;
  paginas: number | null;
  geradoPor: string | null;
};

/** Grava (uma vez por par código/hash) a impressão digital do PDF entregue. */
export async function registrarCertificado(admin: SupabaseClient, r: RegistroCertificado): Promise<string | null> {
  try {
    const sha256 = await sha256Hex(r.bytes.slice().buffer as ArrayBuffer);
    const { error } = await admin.from("dp_documento_certificados").upsert({
      company_id: r.companyId,
      documento_id: r.documentoId,
      aceite_id: r.aceiteId,
      codigo: r.codigo,
      sha256,
      tamanho_bytes: r.bytes.byteLength,
      paginas: r.paginas,
      gerado_por: r.geradoPor,
    }, { onConflict: "codigo,sha256", ignoreDuplicates: true });
    if (error) throw error;
    return sha256;
  } catch (e) {
    // O certificado continua sendo entregue; a próxima abertura (cache) tenta registrar de novo.
    await recordEdgeError({
      functionName: "dp-documento-certificado",
      action: "registrar impressão digital do certificado",
      error: e,
      details: { documento_id: r.documentoId, codigo: r.codigo },
    });
    return null;
  }
}
