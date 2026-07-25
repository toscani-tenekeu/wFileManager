begin;

create table if not exists public.wfilemanager_backup_keys (
  version text primary key,
  vault_secret_id uuid not null unique,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

alter table public.wfilemanager_backup_keys enable row level security;
revoke all on table public.wfilemanager_backup_keys from public, anon, authenticated;
grant select, insert, update on table public.wfilemanager_backup_keys to service_role;

create unique index if not exists wfilemanager_backup_keys_one_active_uidx
  on public.wfilemanager_backup_keys(active)
  where active = true;

do $$
declare
  v_secret_id uuid;
begin
  if not exists (select 1 from public.wfilemanager_backup_keys) then
    v_secret_id := vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'wfilemanager-backup-v1',
      'wFileManager AES-256-GCM backup encryption key version v1'
    );
    insert into public.wfilemanager_backup_keys(version, vault_secret_id, active)
    values ('v1', v_secret_id, true);
  end if;
end;
$$;

create or replace function public.wfilemanager_backup_current_key()
returns table(version text, secret text)
language sql
security definer
set search_path = public, vault
as $$
  select k.version, s.decrypted_secret
  from public.wfilemanager_backup_keys k
  join vault.decrypted_secrets s on s.id = k.vault_secret_id
  where k.active = true
  limit 1;
$$;

create or replace function public.wfilemanager_backup_key_by_version(p_version text)
returns table(version text, secret text)
language sql
security definer
set search_path = public, vault
as $$
  select k.version, s.decrypted_secret
  from public.wfilemanager_backup_keys k
  join vault.decrypted_secrets s on s.id = k.vault_secret_id
  where k.version = p_version
  limit 1;
$$;

create or replace function public.wfilemanager_rotate_backup_key()
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_number integer;
  v_version text;
  v_secret_id uuid;
begin
  select coalesce(max(nullif(regexp_replace(version, '[^0-9]', '', 'g'), '')::integer), 0) + 1
  into v_number
  from public.wfilemanager_backup_keys;
  v_version := 'v' || v_number::text;
  v_secret_id := vault.create_secret(
    encode(gen_random_bytes(32), 'hex'),
    'wfilemanager-backup-' || v_version,
    'wFileManager AES-256-GCM backup encryption key version ' || v_version
  );
  update public.wfilemanager_backup_keys
  set active = false, retired_at = coalesce(retired_at, now())
  where active = true;
  insert into public.wfilemanager_backup_keys(version, vault_secret_id, active)
  values (v_version, v_secret_id, true);
  return v_version;
end;
$$;

revoke all on function public.wfilemanager_backup_current_key() from public, anon, authenticated;
revoke all on function public.wfilemanager_backup_key_by_version(text) from public, anon, authenticated;
revoke all on function public.wfilemanager_rotate_backup_key() from public, anon, authenticated;
grant execute on function public.wfilemanager_backup_current_key() to service_role;
grant execute on function public.wfilemanager_backup_key_by_version(text) to service_role;
grant execute on function public.wfilemanager_rotate_backup_key() to service_role;

create or replace function public.wfilemanager_restore_managed_snapshot(
  p_instance_id uuid,
  p_document jsonb,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_document_instance uuid;
  v_roles integer := jsonb_array_length(coalesce(p_document #> '{data,roles}', '[]'::jsonb));
  v_users integer := jsonb_array_length(coalesce(p_document #> '{data,users}', '[]'::jsonb));
  v_settings integer := jsonb_array_length(coalesce(p_document #> '{data,settings}', '[]'::jsonb));
  v_notifications integer := jsonb_array_length(coalesce(p_document #> '{data,notifications}', '[]'::jsonb));
  v_path_rules integer := jsonb_array_length(coalesce(p_document #> '{data,pathRules}', '[]'::jsonb));
  v_audit_logs integer := jsonb_array_length(coalesce(p_document #> '{data,auditLogs}', '[]'::jsonb));
begin
  if p_document ->> 'format' <> 'wfilemanager-pro-snapshot-v1' then
    raise exception using message = 'unsupported_snapshot_format', errcode = 'P0001';
  end if;

  v_document_instance := nullif(p_document #>> '{instance,id}', '')::uuid;
  if v_document_instance is null or v_document_instance <> p_instance_id then
    raise exception using message = 'snapshot_instance_mismatch', errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(
      coalesce(p_document #> '{data,roles}', '[]'::jsonb) ||
      coalesce(p_document #> '{data,users}', '[]'::jsonb) ||
      coalesce(p_document #> '{data,settings}', '[]'::jsonb) ||
      coalesce(p_document #> '{data,notifications}', '[]'::jsonb) ||
      coalesce(p_document #> '{data,pathRules}', '[]'::jsonb) ||
      coalesce(p_document #> '{data,auditLogs}', '[]'::jsonb)
    ) as item
    where nullif(item ->> 'instance_id', '')::uuid is distinct from p_instance_id
  ) then
    raise exception using message = 'snapshot_contains_foreign_instance_rows', errcode = 'P0001';
  end if;

  perform 1 from public.wfilemanager_instances where id = p_instance_id for update;
  if not found then
    raise exception using message = 'instance_not_found', errcode = 'P0001';
  end if;

  if p_dry_run then
    create temp table wfm_restore_roles (like public.wfilemanager_roles including all) on commit drop;
    create temp table wfm_restore_users (like public.wfilemanager_users including all) on commit drop;
    create temp table wfm_restore_settings (like public.wfilemanager_settings including all) on commit drop;
    create temp table wfm_restore_notifications (like public.wfilemanager_notifications including all) on commit drop;
    create temp table wfm_restore_path_rules (like public.wfilemanager_path_rules including all) on commit drop;
    create temp table wfm_restore_audit_logs (like public.wfilemanager_audit_logs including all) on commit drop;

    insert into wfm_restore_roles
    select * from jsonb_populate_recordset(null::public.wfilemanager_roles, coalesce(p_document #> '{data,roles}', '[]'::jsonb));
    insert into wfm_restore_users
    select * from jsonb_populate_recordset(null::public.wfilemanager_users, coalesce(p_document #> '{data,users}', '[]'::jsonb));
    insert into wfm_restore_settings
    select * from jsonb_populate_recordset(null::public.wfilemanager_settings, coalesce(p_document #> '{data,settings}', '[]'::jsonb));
    insert into wfm_restore_notifications
    select * from jsonb_populate_recordset(null::public.wfilemanager_notifications, coalesce(p_document #> '{data,notifications}', '[]'::jsonb));
    insert into wfm_restore_path_rules
    select * from jsonb_populate_recordset(null::public.wfilemanager_path_rules, coalesce(p_document #> '{data,pathRules}', '[]'::jsonb));
    insert into wfm_restore_audit_logs
    select * from jsonb_populate_recordset(null::public.wfilemanager_audit_logs, coalesce(p_document #> '{data,auditLogs}', '[]'::jsonb));

    return jsonb_build_object(
      'valid', true,
      'dryRun', true,
      'schemaValidated', true,
      'counts', jsonb_build_object(
        'roles', v_roles,
        'users', v_users,
        'settings', v_settings,
        'notifications', v_notifications,
        'pathRules', v_path_rules,
        'auditLogs', v_audit_logs
      )
    );
  end if;

  delete from public.wfilemanager_sessions where instance_id = p_instance_id;
  delete from public.wfilemanager_notifications where instance_id = p_instance_id;
  delete from public.wfilemanager_path_rules where instance_id = p_instance_id;
  delete from public.wfilemanager_audit_logs where instance_id = p_instance_id;
  delete from public.wfilemanager_users where instance_id = p_instance_id;
  delete from public.wfilemanager_roles where instance_id = p_instance_id;
  delete from public.wfilemanager_settings where instance_id = p_instance_id;

  insert into public.wfilemanager_roles
  select * from jsonb_populate_recordset(null::public.wfilemanager_roles, coalesce(p_document #> '{data,roles}', '[]'::jsonb));
  insert into public.wfilemanager_users
  select * from jsonb_populate_recordset(null::public.wfilemanager_users, coalesce(p_document #> '{data,users}', '[]'::jsonb));
  insert into public.wfilemanager_settings
  select * from jsonb_populate_recordset(null::public.wfilemanager_settings, coalesce(p_document #> '{data,settings}', '[]'::jsonb));
  insert into public.wfilemanager_notifications
  select * from jsonb_populate_recordset(null::public.wfilemanager_notifications, coalesce(p_document #> '{data,notifications}', '[]'::jsonb));
  insert into public.wfilemanager_path_rules
  select * from jsonb_populate_recordset(null::public.wfilemanager_path_rules, coalesce(p_document #> '{data,pathRules}', '[]'::jsonb));
  insert into public.wfilemanager_audit_logs
  select * from jsonb_populate_recordset(null::public.wfilemanager_audit_logs, coalesce(p_document #> '{data,auditLogs}', '[]'::jsonb));

  update public.wfilemanager_instances
  set updated_at = now(), last_seen_at = now()
  where id = p_instance_id;

  return jsonb_build_object(
    'valid', true,
    'dryRun', false,
    'restored', true,
    'sessionsRevoked', true,
    'schemaValidated', true,
    'counts', jsonb_build_object(
      'roles', v_roles,
      'users', v_users,
      'settings', v_settings,
      'notifications', v_notifications,
      'pathRules', v_path_rules,
      'auditLogs', v_audit_logs
    )
  );
end;
$$;

revoke all on function public.wfilemanager_restore_managed_snapshot(uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.wfilemanager_restore_managed_snapshot(uuid,jsonb,boolean) to service_role;

commit;
