alter table public.kehe_velocity
  add column if not exists period_type text default 'monthly',
  add column if not exists period_start_date date,
  add column if not exists period_end_date date;

update public.kehe_velocity
set period_type = 'monthly'
where period_type is null;

create index if not exists kehe_velocity_period_type_idx
  on public.kehe_velocity (period_type);

create index if not exists kehe_velocity_period_end_date_idx
  on public.kehe_velocity (period_end_date);
