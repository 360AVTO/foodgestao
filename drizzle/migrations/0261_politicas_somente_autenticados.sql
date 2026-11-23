-- 1) Storage: documentos do DP somente para autenticados
DROP POLICY IF EXISTS dp_doc_bucket_admin_write ON storage.objects;
CREATE POLICY dp_doc_bucket_admin_write ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'dp-documentos'
    AND (
      private.is_company_admin_or_owner((SELECT auth.uid()), public.try_cast_uuid(split_part(name, '/', 1)))
      OR public.is_super_admin((SELECT auth.uid()))
    )
  )
  WITH CHECK (
    bucket_id = 'dp-documentos'
    AND (
      private.is_company_admin_or_owner((SELECT auth.uid()), public.try_cast_uuid(split_part(name, '/', 1)))
      OR public.is_super_admin((SELECT auth.uid()))
    )
  );

-- 2) Mural de avisos somente para autenticados
DROP POLICY IF EXISTS dp_avisos_read ON public.dp_avisos;
CREATE POLICY dp_avisos_read ON public.dp_avisos
  FOR SELECT TO authenticated
  USING (
    private.is_company_member((SELECT auth.uid()), company_id)
    OR (
      private.is_dp_colaborador_of_company((SELECT auth.uid()), company_id)
      AND private.dp_aviso_alcanca((SELECT auth.uid()), company_id, escopo, unidade_id, cargo_id, colaborador_id, publico)
    )
  );

-- 3) Gerador de políticas das partições de auditoria (partições futuras)
CREATE OR REPLACE FUNCTION private.apply_audit_log_partition_policies(_part_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS "Super admins can view audit logs" ON public.%I', _part_name);
  EXECUTE format('DROP POLICY IF EXISTS "Users can insert own audit logs" ON public.%I', _part_name);
  EXECUTE format(
    'CREATE POLICY "Super admins can view audit logs" ON public.%I FOR SELECT TO authenticated USING (public.is_super_admin((SELECT auth.uid())))',
    _part_name
  );
  EXECUTE format(
    'CREATE POLICY "Users can insert own audit logs" ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id)',
    _part_name
  );
END;
$function$;

-- 4) Reaplicar nas partições mensais existentes
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT c.relname
    FROM pg_inherits inh
    JOIN pg_class p ON p.oid = inh.inhparent
    JOIN pg_class c ON c.oid = inh.inhrelid
    WHERE p.relname = 'audit_logs'
      AND p.relnamespace = 'public'::regnamespace
      AND c.relname ~ '^audit_logs_\d{4}_\d{2}$'
  LOOP
    PERFORM private.apply_audit_log_partition_policies(rec.relname);
  END LOOP;
END;
$$;