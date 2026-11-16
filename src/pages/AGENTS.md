# Regras de src/pages

- Company invites: expired (status or past `expires_at`) are renewed only via `company_invite_renovar` (new token, +7 days, caller becomes sender, group-wide within administered companies); cancel/delete remove the whole `grupo_id` except accepted rows — avoids orphan multi-company invites.
