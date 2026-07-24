-- wFileManager 0.8.0 managed application-data hardening.
-- Separates routine heartbeat credentials from offline recovery keys and removes
-- automatic managed-data deletion based solely on missing server heartbeats.

alter table public.wfilemanager_instances
  add column if not exists service_plan text not null default 'pro',
  add column if not exists subscription_status text not null default 'active',
  add column if not exists data_status text not null default 'active',
  add column if not exists storage_quota_bytes bigint not null default 104857600,
  add column if not exists storage_used_bytes bigint not null default 0,
  add column if not exists retention_until timestamptz,
  add column if not exists cancellation_requested_at timestamptz;

alter table public.wfilemanager_instances
  drop constraint if exists wfilemanager_instances_service_plan_check,
  add constraint wfilemanager_instances_service_plan_check
  check (service_plan in ('community','pro'));

alter table public.wfilemanager_instances
  drop constraint if exists wfilemanager_instances_subscription_status_check,
  add constraint wfilemanager_instances_subscription_status_check
  check (subscription_status in ('active','trialing','past_due','cancelled','expired'));

alter table public.wfilemanager_instances
  drop constraint if exists wfilemanager_instances_data_status_check,
  add constraint wfilemanager_instances_data_status_check
  check (data_status in ('active','frozen','retention','pending_delete','deleted'));

create table if not exists public.wfilemanager_instance_credentials (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.wfilemanager_instances(id) on delete cascade,
  credential_type text not null check (credential_type in ('heartbeat')),
  secret_hash text not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(instance_id, credential_type)
);

create index if not exists wfilemanager_instance_credentials_lookup_idx
  on public.wfilemanager_instance_credentials (instance_id, credential_type)
  where revoked_at is null;

create table if not exists public.wfilemanager_backup_snapshots (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.wfilemanager_instances(id) on delete cascade,
  snapshot_type text not null default 'automatic' check (snapshot_type in ('automatic','manual','pre_restore','pre_migration')),
  status text not null default 'available' check (status in ('pending','available','failed','expired','deleted')),
  size_bytes bigint not null default 0,
  checksum_sha256 text,
  manifest jsonb not null default '{}'::jsonb,
  storage_path text,
  retention_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wfilemanager_backup_snapshots_instance_created_idx
  on public.wfilemanager_backup_snapshots (instance_id, created_at desc);

create or replace function public.wfilemanager_apply_instance_lifecycle()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  frozen_ids uuid[] := array[]::uuid[];
  frozen_count integer := 0;
begin
  with newly_frozen as (
    update public.wfilemanager_instances
    set status = 'frozen',
        data_status = 'frozen',
        frozen_at = coalesce(frozen_at, now()),
        delete_after_at = null,
        updated_at = now()
    where status = 'active'
      and subscription_status in ('active','trialing','past_due')
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
  set data_status = 'retention',
      retention_until = coalesce(retention_until, now() + interval '30 days'),
      updated_at = now()
  where subscription_status in ('cancelled','expired')
    and data_status not in ('retention','pending_delete','deleted');

  return jsonb_build_object(
    'frozen', frozen_count,
    'deleted', 0,
    'policy', 'no-offline-heartbeat-deletion',
    'processedAt', now()
  );
end;
$$;

revoke all on function public.wfilemanager_apply_instance_lifecycle() from public, anon, authenticated;
grant execute on function public.wfilemanager_apply_instance_lifecycle() to service_role;

comment on table public.wfilemanager_instance_credentials is
  'Per-instance online credentials. Routine heartbeats use these instead of offline Recovery Kit keys.';
comment on table public.wfilemanager_backup_snapshots is
  'Managed application-data snapshots for Pro recovery. Server filesystem files are outside this scope.';
comment on column public.wfilemanager_instances.retention_until is
  'Managed-data retention deadline after cancellation or expiration. Offline heartbeat alone does not set this value.';
comment on column public.wfilemanager_instances.delete_after_at is
  'Legacy column kept for compatibility. 0.8.0 lifecycle no longer schedules deletion solely from heartbeat inactivity.';
