begin;

create or replace function public.wfilemanager_prepare_instance_deletion(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.wfilemanager_lifecycle_events%rowtype;
  v_paths jsonb;
begin
  select * into v_event
  from public.wfilemanager_lifecycle_events
  where id = p_event_id
  for update;

  if not found then
    raise exception using message = 'lifecycle_event_not_found', errcode = 'P0001';
  end if;

  if v_event.status in ('database_deleted', 'cleanup_failed') then
    return jsonb_build_object(
      'eventId', v_event.id,
      'instanceKey', v_event.instance_key,
      'customerEmail', v_event.customer_email,
      'customerName', v_event.customer_name,
      'cleanupPaths', coalesce(v_event.metadata -> 'cleanup_paths', '[]'::jsonb),
      'databaseDeleted', true
    );
  end if;

  if v_event.status not in ('pending', 'failed', 'processing') then
    raise exception using message = 'lifecycle_event_not_deletable', errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(storage_path) filter (where storage_path is not null), '[]'::jsonb)
  into v_paths
  from public.wfilemanager_backup_snapshots
  where instance_id = v_event.instance_id;

  update public.wfilemanager_lifecycle_events
  set status = 'processing',
      attempt_count = attempt_count + 1,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cleanup_paths', v_paths),
      last_error = null
  where id = p_event_id;

  if v_event.instance_id is not null then
    perform public.wfilemanager_delete_instance(v_event.instance_id);
  end if;

  update public.wfilemanager_lifecycle_events
  set status = 'database_deleted',
      instance_id = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'cleanup_paths', v_paths,
        'database_deleted_at', now()
      ),
      last_error = null,
      next_attempt_at = now()
  where id = p_event_id;

  return jsonb_build_object(
    'eventId', v_event.id,
    'instanceKey', v_event.instance_key,
    'customerEmail', v_event.customer_email,
    'customerName', v_event.customer_name,
    'cleanupPaths', v_paths,
    'databaseDeleted', true
  );
end;
$$;

revoke all on function public.wfilemanager_prepare_instance_deletion(uuid) from public, anon, authenticated;
grant execute on function public.wfilemanager_prepare_instance_deletion(uuid) to service_role;

select cron.alter_job(
  7,
  command := replace(
    (select command from cron.job where jobid = 7),
    'wfilemanager-billing-automation-api',
    'wfilemanager-billing-safe-api'
  )
);

select cron.alter_job(
  8,
  command := replace(
    (select command from cron.job where jobid = 8),
    'wfilemanager-billing-automation-api',
    'wfilemanager-billing-safe-api'
  )
);

commit;
