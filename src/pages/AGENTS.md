# Regras de src/pages

- Company invites: expired (status or past `expires_at`) are renewed only via `company_invite_renovar` (new token, +7 days, caller becomes sender, group-wide within administered companies); cancel/delete remove the whole `grupo_id` except accepted rows — avoids orphan multi-company invites.
- Screens that define a new password use `BlocoNovaSenha` and block submit only via `motivoSenhaPendente` (shown inline, field refocused), never a silently disabled button; server password refusals are shown at the field — keeps every password screen identical and explanatory.
