create extension if not exists pg_cron with schema extensions;

alter table public.wfilemanager_instances
  drop constraint if exists wfilemanager_instances_status_check;

alter table public.wfilemanager_instances
  add constraint wfilemanager_instances_status_check
  check (status = any (array['active'::text, 'frozen'::text, 'disabled'::text]));

alter table public.wfilemanager_instances
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists frozen_at timestamptz,
  add column if not exists delete_after_at timestamptz,
  add column if not exists recovered_at timestamptz;

update public.wfilemanager_instances
set last_seen_at = coalesce(last_seen_at, updated_at, created_at, now())
where last_seen_at is null;

create index if not exists wfilemanager_instances_lifecycle_idx
  on public.wfilemanager_instances (status, last_seen_at);

create or replace function public.wfilemanager_delete_instance(p_instance_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.wfilemanager_instances where id = p_instance_id
  ) then
    return false;
  end if;

  delete from public.wfilemanager_notifications where instance_id = p_instance_id;
  delete from public.wfilemanager_path_rules where instance_id = p_instance_id;
  delete from public.wfilemanager_settings where instance_id = p_instance_id;
  delete from public.wfilemanager_audit_logs where instance_id = p_instance_id;
  delete from public.wfilemanager_sessions where instance_id = p_instance_id;
  delete from public.wfilemanager_users where instance_id = p_instance_id;
  delete from public.wfilemanager_roles where instance_id = p_instance_id;
  delete from public.wfilemanager_root_reset_tokens where instance_id = p_instance_id;
  delete from public.wfilemanager_instances where id = p_instance_id;

  return true;
end;
$$;

revoke all on function public.wfilemanager_delete_instance(uuid) from public, anon, authenticated;
grant execute on function public.wfilemanager_delete_instance(uuid) to service_role;

create or replace function public.wfilemanager_apply_instance_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  frozen_ids uuid[] := array[]::uuid[];
  candidate record;
  frozen_count integer := 0;
  deleted_count integer := 0;
begin
  with newly_frozen as (
    update public.wfilemanager_instances
    set status = 'frozen',
        frozen_at = coalesce(frozen_at, now()),
        delete_after_at = last_seen_at + interval '90 days',
        updated_at = now()
    where status = 'active'
      and last_seen_at <= now() - interval '30 days'
    returning id
  )
  select coalesce(array_agg(id), array[]::uuid[])
  into frozen_ids
  from newly_frozen;

  frozen_count := coalesce(cardinality(frozen_ids), 0);

  if frozen_count > 0 then
    update public.wfilemanager_sessions
    set revoked_at = coalesce(revoked_at, now())
    where instance_id = any(frozen_ids)
      and revoked_at is null;
  end if;

  update public.wfilemanager_instances
  set delete_after_at = last_seen_at + interval '90 days',
      updated_at = now()
  where status = 'frozen'
    and delete_after_at is null;

  for candidate in
    select id
    from public.wfilemanager_instances
    where last_seen_at <= now() - interval '90 days'
  loop
    if public.wfilemanager_delete_instance(candidate.id) then
      deleted_count := deleted_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'frozen', frozen_count,
    'deleted', deleted_count,
    'processedAt', now()
  );
end;
$$;

revoke all on function public.wfilemanager_apply_instance_lifecycle() from public, anon, authenticated;
grant execute on function public.wfilemanager_apply_instance_lifecycle() to service_role;

comment on column public.wfilemanager_instances.last_seen_at is
  'Last valid signed heartbeat or authenticated API activity from the installation.';
comment on column public.wfilemanager_instances.frozen_at is
  'Set after 30 days without a valid heartbeat. Data remains stored but normal login is blocked.';
comment on column public.wfilemanager_instances.delete_after_at is
  'Scheduled permanent deletion time, 90 days after the last valid activity.';

select cron.unschedule(jobid)
from cron.job
where jobname = 'wfilemanager-instance-lifecycle';

select cron.schedule(
  'wfilemanager-instance-lifecycle',
  '17 * * * *',
  'select public.wfilemanager_apply_instance_lifecycle();'
);
