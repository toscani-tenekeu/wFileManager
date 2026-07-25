create table if not exists public.wfilemanager_customer_auth_tokens (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.wfilemanager_customer_accounts(id) on delete cascade,
  purpose text not null check (purpose in ('password_reset','email_verification')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.wfilemanager_customer_auth_tokens enable row level security;
revoke all on table public.wfilemanager_customer_auth_tokens from public, anon, authenticated;

create index if not exists wfilemanager_customer_auth_tokens_customer_idx
  on public.wfilemanager_customer_auth_tokens(customer_id, purpose, created_at desc);
create index if not exists wfilemanager_customer_auth_tokens_expiry_idx
  on public.wfilemanager_customer_auth_tokens(expires_at)
  where consumed_at is null;

create or replace function public.wfilemanager_consume_customer_auth_token(
  p_token_hash text,
  p_purpose text,
  p_password_hash text default null,
  p_password_salt text default null,
  p_password_iterations integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.wfilemanager_customer_auth_tokens%rowtype;
  v_customer public.wfilemanager_customer_accounts%rowtype;
begin
  select * into v_token
  from public.wfilemanager_customer_auth_tokens
  where token_hash = p_token_hash
    and purpose = p_purpose
    and consumed_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception using message = 'invalid_or_expired_token', errcode = 'P0001';
  end if;

  select * into v_customer
  from public.wfilemanager_customer_accounts
  where id = v_token.customer_id
    and status = 'active'
  for update;

  if not found then
    raise exception using message = 'customer_unavailable', errcode = 'P0001';
  end if;

  update public.wfilemanager_customer_auth_tokens
  set consumed_at = now()
  where id = v_token.id;

  if p_purpose = 'password_reset' then
    if coalesce(p_password_hash, '') = '' or coalesce(p_password_salt, '') = '' or coalesce(p_password_iterations, 0) < 100000 then
      raise exception using message = 'invalid_password_material', errcode = 'P0001';
    end if;
    update public.wfilemanager_customer_accounts
    set password_hash = p_password_hash,
        password_salt = p_password_salt,
        password_iterations = p_password_iterations,
        updated_at = now()
    where id = v_customer.id;
    update public.wfilemanager_customer_sessions
    set revoked_at = now()
    where customer_id = v_customer.id and revoked_at is null;
  elsif p_purpose = 'email_verification' then
    update public.wfilemanager_customer_accounts
    set email_verified_at = coalesce(email_verified_at, now()),
        updated_at = now()
    where id = v_customer.id;
  else
    raise exception using message = 'unsupported_token_purpose', errcode = 'P0001';
  end if;

  update public.wfilemanager_customer_auth_tokens
  set consumed_at = now()
  where customer_id = v_customer.id
    and purpose = p_purpose
    and consumed_at is null;

  return jsonb_build_object(
    'customerId', v_customer.id,
    'email', v_customer.email,
    'purpose', p_purpose,
    'success', true
  );
end;
$$;

revoke all on function public.wfilemanager_consume_customer_auth_token(text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.wfilemanager_consume_customer_auth_token(text,text,text,text,integer) to service_role;
