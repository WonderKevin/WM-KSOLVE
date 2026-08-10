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

drop policy if exists "report_snapshots_select_by_app_permission" on public.report_snapshots;
create policy "report_snapshots_select_by_app_permission"
on public.report_snapshots
for select
to authenticated
using (
  case report_key
    when 'broker-data-sets'
      then public.has_app_permission('can_view_broker_commission_data_sets')
    else false
  end
);

drop policy if exists "report_snapshots_insert_by_app_permission" on public.report_snapshots;
create policy "report_snapshots_insert_by_app_permission"
on public.report_snapshots
for insert
to authenticated
with check (
  case report_key
    when 'broker-data-sets'
      then public.has_app_permission('can_view_broker_commission_data_sets')
    else false
  end
);

drop policy if exists "report_snapshots_update_by_app_permission" on public.report_snapshots;
create policy "report_snapshots_update_by_app_permission"
on public.report_snapshots
for update
to authenticated
using (
  case report_key
    when 'broker-data-sets'
      then public.has_app_permission('can_view_broker_commission_data_sets')
    else false
  end
)
with check (
  case report_key
    when 'broker-data-sets'
      then public.has_app_permission('can_view_broker_commission_data_sets')
    else false
  end
);
