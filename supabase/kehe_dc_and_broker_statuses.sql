-- Run this in the Supabase SQL editor before uploading DC location mappings
-- or saving KeHe broker commission statuses.

alter table public.locations
add column if not exists dc text;

create index if not exists locations_customer_area_idx
on public.locations (customer, retailer_area);

create index if not exists locations_dc_idx
on public.locations (dc);

create table if not exists public.broker_commission_statuses (
  month text primary key,
  status text not null check (status in ('Invoice Confirmed', 'Bill Paid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists broker_commission_statuses_status_idx
on public.broker_commission_statuses (status);
