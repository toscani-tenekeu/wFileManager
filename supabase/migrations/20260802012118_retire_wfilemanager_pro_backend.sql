-- Run only after the authenticated 0.10.0 retirement handshake has deleted
-- every managed instance. The guard makes an early teardown fail closed.
do $$
begin
  if exists (select 1 from public.wfilemanager_instances) then
    raise exception 'wFileManager backend retirement refused: managed instances still exist';
  end if;
end
$$;

do $$
declare
  job record;
begin
  for job in
    select jobid
    from cron.job
    where jobname like 'wfilemanager-%'
       or command ilike '%wfilemanager%'
  loop
    perform cron.unschedule(job.jobid);
  end loop;
end
$$;

do $$
declare
  relation record;
begin
  for relation in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
      and tablename like 'wfilemanager_%'
      and tablename <> 'wfilemanager_release_publish_tokens'
  loop
    execute format('drop table if exists %I.%I cascade', relation.schemaname, relation.tablename);
  end loop;
end
$$;

do $$
declare
  routine record;
begin
  for routine in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'wfilemanager_%'
  loop
    execute format(
      'drop function if exists %I.%I(%s) cascade',
      routine.nspname,
      routine.proname,
      routine.arguments
    );
  end loop;
end
$$;

delete from vault.secrets where name = 'wfilemanager-backup-v1';

-- Supabase Storage objects and buckets are deliberately not touched here.
-- Delete wfilemanager-backups and wfilemanager-documents through the Storage
-- API after this migration; direct SQL deletion from storage.* is unsupported.
