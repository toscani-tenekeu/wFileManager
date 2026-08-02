-- Transition-only fields used to retire the last managed Pro installation.
-- decommission_requested_at must be set explicitly only after a 0.10.0-capable
-- heartbeat has been observed. A null value can never trigger removal.
alter table public.wfilemanager_instances
  add column if not exists last_app_version text,
  add column if not exists capabilities jsonb not null default '[]'::jsonb,
  add column if not exists decommission_requested_at timestamptz;

comment on column public.wfilemanager_instances.decommission_requested_at is
  'Explicit operator request for the authenticated 0.10.0 Pro retirement handshake.';
