-- Run this in the Supabase SQL editor to make KeHE broker transfer allocations
-- shared across users instead of browser-local.

create table if not exists public.broker_commission_transfer_allocations (
  allocation_key text primary key,
  month text not null,
  target_retailer text not null,
  invoice_numbers text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists broker_commission_transfer_allocations_month_idx
on public.broker_commission_transfer_allocations (month);

create index if not exists broker_commission_transfer_allocations_target_retailer_idx
on public.broker_commission_transfer_allocations (target_retailer);

alter table public.broker_commission_transfer_allocations enable row level security;

grant select, insert, update, delete
on public.broker_commission_transfer_allocations
to authenticated;

drop policy if exists "Authenticated users can read broker transfer allocations"
on public.broker_commission_transfer_allocations;

create policy "Authenticated users can read broker transfer allocations"
on public.broker_commission_transfer_allocations
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can insert broker transfer allocations"
on public.broker_commission_transfer_allocations;

create policy "Authenticated users can insert broker transfer allocations"
on public.broker_commission_transfer_allocations
for insert
to authenticated
with check (true);

drop policy if exists "Authenticated users can update broker transfer allocations"
on public.broker_commission_transfer_allocations;

create policy "Authenticated users can update broker transfer allocations"
on public.broker_commission_transfer_allocations
for update
to authenticated
using (true)
with check (true);

drop policy if exists "Authenticated users can delete broker transfer allocations"
on public.broker_commission_transfer_allocations;

create policy "Authenticated users can delete broker transfer allocations"
on public.broker_commission_transfer_allocations
for delete
to authenticated
using (true);
