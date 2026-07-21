-- Applied to Supabase project igihzeyfgwhnuiflamvn.
-- Every object is prefixed to isolate wFileManager from other applications.
create extension if not exists pgcrypto;

create table if not exists public.wfilemanager_instances (
  id uuid primary key default gen_random_uuid(),
  instance_key text not null unique,
  name text not null default 'wFileManager',
  hostname text,
  base_url text,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wfilemanager_roles (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid references public.wfilemanager_instances(id) on delete cascade,
  name text not null,
  description text,
  permissions jsonb not null default '[]'::jsonb,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(instance_id, name)
);

create table if not exists public.wfilemanager_users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid references public.wfilemanager_instances(id) on delete cascade,
  role_id uuid references public.wfilemanager_roles(id) on delete set null,
  username text not null,
  email text,
  display_name text not null,
  password_hash text not null,
  password_salt text not null,
  password_iterations integer not null default 210000,
  status text not null default 'active' check (status in ('active','disabled','invited')),
  is_admin boolean not null default false,
  must_change_password boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(instance_id, username),
  unique(instance_id, email)
);

create table if not exists public.wfilemanager_sessions (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid references public.wfilemanager_instances(id) on delete cascade,
  user_id uuid not null references public.wfilemanager_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.wfilemanager_path_rules (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid references public.wfilemanager_instances(id) on delete cascade,
  user_id uuid references public.wfilemanager_users(id) on delete cascade,
  role_id uuid references public.wfilemanager_roles(id) on delete cascade,
  path text not null,
  access_mode text not null check (access_mode in ('allow','deny','read_only','hidden')),
  recursive boolean not null default true,
  created_at timestamptz not null default now(),
  check (user_id is not null or role_id is not null)
);

create table if not exists public.wfilemanager_settings (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid references public.wfilemanager_instances(id) on delete cascade,
  setting_key text not null,
  setting_value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.wfilemanager_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(instance_id, setting_key)
);

create table if not exists public.wfilemanager_audit_logs (
  id bigint generated always as identity primary key,
  instance_id uuid references public.wfilemanager_instances(id) on delete cascade,
  user_id uuid references public.wfilemanager_users(id) on delete set null,
  username text,
  action text not null,
  target text,
  result text not null default 'success' check (result in ('success','failure','warning')),
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists wfilemanager_sessions_user_idx on public.wfilemanager_sessions(user_id);
create index if not exists wfilemanager_sessions_expiry_idx on public.wfilemanager_sessions(expires_at);
create index if not exists wfilemanager_users_instance_idx on public.wfilemanager_users(instance_id);
create index if not exists wfilemanager_audit_instance_created_idx on public.wfilemanager_audit_logs(instance_id, created_at desc);
create index if not exists wfilemanager_path_rules_user_idx on public.wfilemanager_path_rules(user_id);
create index if not exists wfilemanager_path_rules_role_idx on public.wfilemanager_path_rules(role_id);

alter table public.wfilemanager_instances enable row level security;
alter table public.wfilemanager_roles enable row level security;
alter table public.wfilemanager_users enable row level security;
alter table public.wfilemanager_sessions enable row level security;
alter table public.wfilemanager_path_rules enable row level security;
alter table public.wfilemanager_settings enable row level security;
alter table public.wfilemanager_audit_logs enable row level security;
