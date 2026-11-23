REVOKE ALL ON FUNCTION private.apply_audit_log_partition_policies(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.manage_audit_logs_partitions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.apply_audit_log_partition_policies(text) TO service_role;
GRANT EXECUTE ON FUNCTION private.manage_audit_logs_partitions() TO service_role;