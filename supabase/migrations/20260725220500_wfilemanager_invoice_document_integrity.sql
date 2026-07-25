begin;

alter table public.wfilemanager_pro_subscription_config
  add column if not exists invoice_legal_name text,
  add column if not exists invoice_legal_address text,
  add column if not exists invoice_registration_number text,
  add column if not exists invoice_tax_number text,
  add column if not exists invoice_footer_note text;

update public.wfilemanager_pro_subscription_config
set invoice_legal_name = coalesce(nullif(invoice_legal_name, ''), 'KmerHosting LLC')
where id = true;

commit;
