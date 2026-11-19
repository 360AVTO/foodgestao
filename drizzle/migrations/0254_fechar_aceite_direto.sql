REVOKE ALL ON FUNCTION public.dp_documento_aceitar(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dp_documento_aceitar(uuid, text, text) TO service_role;
COMMENT ON FUNCTION public.dp_documento_aceitar(uuid, text, text) IS 'DEPRECATED: replaced by dp_documento_aceitar_servidor (server-only, atomic signature image, portal term check).';