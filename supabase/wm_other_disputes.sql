create table if not exists public.wm_other_disputes (
  id uuid primary key default gen_random_uuid(),
  date date,
  dispute text not null default '',
  location text not null default '',
  amount numeric not null default 0,
  status text not null default 'Open',
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wm_other_disputes_date_idx
  on public.wm_other_disputes (date);

create index if not exists wm_other_disputes_status_idx
  on public.wm_other_disputes (status);

alter table public.wm_other_disputes enable row level security;

drop policy if exists "Authenticated users can read WM other disputes" on public.wm_other_disputes;
create policy "Authenticated users can read WM other disputes"
  on public.wm_other_disputes
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can add WM other disputes" on public.wm_other_disputes;
create policy "Authenticated users can add WM other disputes"
  on public.wm_other_disputes
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update WM other disputes" on public.wm_other_disputes;
create policy "Authenticated users can update WM other disputes"
  on public.wm_other_disputes
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can delete WM other disputes" on public.wm_other_disputes;
create policy "Authenticated users can delete WM other disputes"
  on public.wm_other_disputes
  for delete
  to authenticated
  using (true);
