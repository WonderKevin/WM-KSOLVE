-- Fix Supabase Security Advisor findings for broker commission datasets.
-- This keeps access aligned with the existing in-app user_permissions flags.

create or replace function public.has_app_permission(permission_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  user_email text := lower(coalesce(auth.email(), auth.jwt() ->> 'email', ''));
  allowed boolean := false;
begin
  if user_email = '' then
    return false;
  end if;

  if user_email = 'kevin@wondermonday.com' then
    return true;
  end if;

  select case permission_name
    when 'can_view_broker_commission_summary'
      then coalesce(up.can_view_broker_commission_summary, false)
    when 'can_view_broker_commission_data_sets'
      then coalesce(up.can_view_broker_commission_data_sets, false)
    when 'can_view_accounting_summary'
      then coalesce(up.can_view_accounting_summary, false)
    when 'can_view_accounting_wm_invoice_discrepancy'
      then coalesce(up.can_view_accounting_wm_invoice_discrepancy, false)
    when 'can_reprocess_invoices'
      then coalesce(up.can_reprocess_invoices, false)
    else false
  end
  into allowed
  from public.user_permissions up
  where lower(up.email) = user_email
  limit 1;

  return coalesce(allowed, false);
end;
$$;

revoke all on function public.has_app_permission(text) from public;
grant execute on function public.has_app_permission(text) to authenticated;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'broker_commission_datasets'
  loop
    execute format(
      'drop policy if exists %I on public.broker_commission_datasets',
      policy_record.policyname
    );
  end loop;
end;
$$;

alter table public.broker_commission_datasets enable row level security;

grant select, insert, update, delete
on public.broker_commission_datasets
to authenticated;

create policy "broker_commission_datasets_select_by_app_permission"
on public.broker_commission_datasets
for select
to authenticated
using (
  public.has_app_permission('can_view_broker_commission_summary')
  or public.has_app_permission('can_view_broker_commission_data_sets')
  or public.has_app_permission('can_view_accounting_summary')
  or public.has_app_permission('can_view_accounting_wm_invoice_discrepancy')
  or public.has_app_permission('can_reprocess_invoices')
);

create policy "broker_commission_datasets_insert_by_reprocess_permission"
on public.broker_commission_datasets
for insert
to authenticated
with check (
  public.has_app_permission('can_reprocess_invoices')
);

create policy "broker_commission_datasets_update_by_reprocess_permission"
on public.broker_commission_datasets
for update
to authenticated
using (
  public.has_app_permission('can_reprocess_invoices')
)
with check (
  public.has_app_permission('can_reprocess_invoices')
);

create policy "broker_commission_datasets_delete_by_reprocess_permission"
on public.broker_commission_datasets
for delete
to authenticated
using (
  public.has_app_permission('can_reprocess_invoices')
);

alter view if exists public.broker_commission_datasets_with_retailer
set (security_invoker = true);

grant select
on public.broker_commission_datasets_with_retailer
to authenticated;
