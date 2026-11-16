const projectRef = "utjhzpdbqzajrhnzcher";

function fail(message) {
  console.error(`::error::STAGING_SUPABASE_DB_URL: ${message}`);
  process.exit(1);
}

const value = process.env.STAGING_SUPABASE_DB_URL?.trim();
if (!value) fail("secret ausente.");

let url;
try {
  url = new URL(value);
} catch {
  fail("URL inválida. Copie a conexão PostgreSQL em Connect → Session pooler e codifique os caracteres reservados da senha.");
}

if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username ||
    !url.password || /your-password/i.test(url.password) || url.hash) {
  fail("informe a URL PostgreSQL completa com a senha preenchida e codificada.");
}

const direct = url.hostname === `db.${projectRef}.supabase.co`;
const pooler = url.hostname.endsWith(".pooler.supabase.com") &&
  url.username.endsWith(`.${projectRef}`) && url.port === "5432";
if (!direct && !pooler) {
  fail("use a conexão do projeto aveto360-homologacao (direta ou Session pooler na porta 5432).");
}
