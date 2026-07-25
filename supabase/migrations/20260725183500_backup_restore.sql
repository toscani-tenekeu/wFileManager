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

  perform 1 from public.wfilemanager_instances where id = p_instance_id for update;
  if not found then
    raise exception using message = 'instance_not_found', errcode = 'P0001';
  end if;

  if p_dry_run then
    return jsonb_build_object(
      'valid', true,
      'dryRun', true,
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
