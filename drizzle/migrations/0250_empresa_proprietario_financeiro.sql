ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS proprietario_nome text,
  ADD COLUMN IF NOT EXISTS proprietario_whatsapp text,
  ADD COLUMN IF NOT EXISTS proprietario_recebe_cobranca boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS financeiro_nome text,
  ADD COLUMN IF NOT EXISTS financeiro_email text;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_proprietario_nome_tam CHECK (proprietario_nome IS NULL OR char_length(proprietario_nome) <= 120),
  ADD CONSTRAINT companies_financeiro_nome_tam CHECK (financeiro_nome IS NULL OR char_length(financeiro_nome) <= 120),
  ADD CONSTRAINT companies_proprietario_whatsapp_fmt CHECK (proprietario_whatsapp IS NULL OR proprietario_whatsapp ~ '^55[1-9][1-9][0-9]{8,9}$'),
  ADD CONSTRAINT companies_financeiro_email_fmt CHECK (financeiro_email IS NULL OR (char_length(financeiro_email) <= 150 AND financeiro_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'));

COMMENT ON COLUMN public.companies.proprietario_nome IS 'Dono do negócio (pode não ter acesso ao sistema).';
COMMENT ON COLUMN public.companies.proprietario_whatsapp IS 'WhatsApp do dono do negócio, com 55; só recebe cobrança se proprietario_recebe_cobranca.';
COMMENT ON COLUMN public.companies.proprietario_recebe_cobranca IS 'Quando true, a régua de cobrança também envia ao WhatsApp do proprietário. Nasce desligado.';
COMMENT ON COLUMN public.companies.financeiro_nome IS 'Responsável financeiro/cobrança; o WhatsApp dele fica em billing_accounts.whatsapp_cobranca.';
COMMENT ON COLUMN public.companies.financeiro_email IS 'E-mail do responsável financeiro; recebe os avisos de cobrança por e-mail.';