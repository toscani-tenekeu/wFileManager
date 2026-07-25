begin;

alter table public.wfilemanager_pro_orders
  add column if not exists client_idempotency_key text;

alter table public.wfilemanager_wallet_topups
  add column if not exists client_idempotency_key text;

create unique index if not exists wfilemanager_orders_customer_idempotency_uidx
  on public.wfilemanager_pro_orders(customer_id, client_idempotency_key)
  where customer_id is not null and client_idempotency_key is not null;

create unique index if not exists wfilemanager_topups_customer_idempotency_uidx
  on public.wfilemanager_wallet_topups(customer_id, client_idempotency_key)
  where client_idempotency_key is not null;

update public.wfilemanager_pro_orders o
set customer_id = c.id
from public.wfilemanager_customer_accounts c
where o.customer_id is null
  and lower(o.buyer_email) = lower(c.email);

update public.wfilemanager_pro_activation_tokens t
set customer_id = o.customer_id
from public.wfilemanager_pro_orders o
where t.customer_id is null
  and t.order_reference = o.order_reference
  and o.customer_id is not null;

update public.wfilemanager_pro_activation_tokens t
set customer_id = c.id
from public.wfilemanager_customer_accounts c
where t.customer_id is null
  and t.customer_email is not null
  and lower(t.customer_email) = lower(c.email);

update public.wfilemanager_instances i
set billing_customer_id = t.customer_id
from public.wfilemanager_pro_activation_tokens t
where i.billing_customer_id is null
  and t.claimed_by_instance_id = i.id
  and t.customer_id is not null;

create or replace function public.wfilemanager_customer_owns_instance(
  p_customer_id uuid,
  p_instance_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.wfilemanager_instances i
    join public.wfilemanager_pro_activation_tokens t
      on t.claimed_by_instance_id = i.id
     and t.status = 'claimed'
    where i.instance_key = p_instance_key
      and t.customer_id = p_customer_id
  );
$$;

revoke all on function public.wfilemanager_customer_owns_instance(uuid,text) from public, anon, authenticated;
grant execute on function public.wfilemanager_customer_owns_instance(uuid,text) to service_role;

commit;
