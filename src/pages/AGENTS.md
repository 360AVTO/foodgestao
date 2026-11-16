# Regras de src/pages

- Company invites: expired (status or past `expires_at`) are renewed only via `company_invite_renovar` (new token, +7 days, caller becomes sender, group-wide within administered companies); cancel/delete remove the whole `grupo_id` except accepted rows — avoids orphan multi-company invites.
- Screens that define a new password use `BlocoNovaSenha` and block submit only via `motivoSenhaPendente` (shown inline, field refocused), never a silently disabled button; server password refusals are shown at the field — keeps every password screen identical and explanatory.
- Invite identity is decided only in the database (`private.company_invite_identidade`, read by `company_invite_conferir_identidade` and enforced by the insert trigger): email of another person or current member blocks; existing account changes the invite text to "confirm with current password" and the accept screen shows the exact linked account — prevents linking someone to another person's login.
