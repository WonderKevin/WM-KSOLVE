-- Shared app-level report snapshots.
-- Run this in Supabase SQL Editor before relying on Supabase-backed snapshots.

create table if not exists public.report_snapshots (
  report_key text primary key,
  payload jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.report_snapshots enable row level security;

grant select, insert, update, delete
on public.report_snapshots
to authenticated;

create or replace function public.can_access_report_snapshot(snapshot_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case snapshot_key
    when 'accounting-summary'
      then public.has_app_permission('can_view_accounting_summary')
    when 'broker-commission-summary'
      then public.has_app_permission('can_view_broker_commission_summary')
    when 'broker-data-sets'
      then public.has_app_permission('can_view_broker_commission_data_sets')
    when 'check-details'
      then public.has_app_permission('can_view_accounting_check_details')
    when 'deduction-types'
      then public.has_app_permission('can_view_database_deduction_type')
    when 'hyvee-broker-commission'
      then public.has_app_permission('can_view_database_hyvee_invoices')
        or public.has_app_permission('can_view_target_broker_commission')
    when 'hyvee-invoices'
      then public.has_app_permission('can_view_database_hyvee_invoices')
    when 'kehe-dashboard'
      then public.has_app_permission('can_view_dashboard')
        or public.has_app_permission('can_view_kehe_dashboard')
    when 'kehe-velocity'
      then public.has_app_permission('can_view_database_kehe_velocity')
    when 'ksolve-invoices'
      then public.has_app_permission('can_view_database_ksolve_invoices')
    when 'locations'
      then public.has_app_permission('can_view_database_locations')
    when 'product-list'
      then public.has_app_permission('can_view_database_product_list')
    when 'target-broker-commission'
      then public.has_app_permission('can_view_target_broker_commission')
    when 'target-invoices'
      then public.has_app_permission('can_view_database_target_invoices')
    when 'tony-dashboard'
      then public.has_app_permission('can_view_tonys_dashboard')
    when 'tony-invoices'
      then public.has_app_permission('can_view_database_tony_invoices')
    when 'tony-velocity'
      then public.has_app_permission('can_view_database_tony_velocity')
    when 'unfi-invoices'
      then public.has_app_permission('can_view_database_unfi_invoices')
    when 'wegmans-invoices'
      then public.has_app_permission('can_view_database_wegmans')
    when 'wm-dispute'
      then public.has_app_permission('can_view_accounting_wm_invoice_discrepancy')
    else false
  end;
$$;

revoke all on function public.can_access_report_snapshot(text) from public;
grant execute on function public.can_access_report_snapshot(text) to authenticated;

drop policy if exists "report_snapshots_select_by_app_permission" on public.report_snapshots;
create policy "report_snapshots_select_by_app_permission"
on public.report_snapshots
for select
to authenticated
using (public.can_access_report_snapshot(report_key));

drop policy if exists "report_snapshots_insert_by_app_permission" on public.report_snapshots;
create policy "report_snapshots_insert_by_app_permission"
on public.report_snapshots
for insert
to authenticated
with check (public.can_access_report_snapshot(report_key));

drop policy if exists "report_snapshots_update_by_app_permission" on public.report_snapshots;
create policy "report_snapshots_update_by_app_permission"
on public.report_snapshots
for update
to authenticated
using (public.can_access_report_snapshot(report_key))
with check (public.can_access_report_snapshot(report_key));
