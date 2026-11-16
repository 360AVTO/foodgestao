# Regras de migrações

- Client-callable `SECURITY DEFINER` routines use static SQL with fixed table/column allowlists, never `EXECUTE` with caller-shaped SQL — caller input must not shape the commands run with owner privileges.
