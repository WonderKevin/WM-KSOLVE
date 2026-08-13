-- Diagnostic: find the July KeHE Velocity rows that resolve to "Unassigned DC".
-- Run in the Supabase SQL editor (bypasses RLS). Read-only; changes nothing.
--
-- A row is "Unassigned" when its (retailer_area, customer) does not match any
-- locations row that has a non-empty dc. This mirrors the dashboard's primary
-- (normalized exact) match; the app also has fuzzy/store-code fallbacks, so this
-- may list a few extra near-matches — the real culprit is the row(s) whose cases
-- add up to the "Unassigned DC" total shown in the dashboard.

-- Normalization mirrors normalizeLocationMatch() in KeheDashboardView.tsx:
--   uppercase, & -> AND, drop '#', [-_/(),.] -> space, collapse spaces, trim.
create or replace function pg_temp.norm(v text)
returns text language sql immutable as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        replace(replace(upper(replace(coalesce(v, ''), chr(160), ' ')), '&', 'AND'), '#', ''),
        '[-_/(),.]', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  );
$$;

with july as (
  select retailer_area, customer, retailer,
         sum(coalesce(cases, 0)) as cases,
         count(*) as rows
  from public.kehe_velocity
  where month ilike 'July%'
  group by retailer_area, customer, retailer
),
loc as (
  select pg_temp.norm(retailer_area) as ka,
         pg_temp.norm(customer)      as kc,
         max(nullif(btrim(coalesce(dc, '')), '')) as dc
  from public.locations
  group by 1, 2
)
select j.retailer_area,
       j.customer,
       j.retailer,
       j.cases,
       j.rows,
       l.dc as matched_dc,
       case when l.ka is null then 'no location match'
            when l.dc is null then 'location exists but dc is blank'
            else 'matched' end as status
from july j
left join loc l
  on l.ka = pg_temp.norm(j.retailer_area)
 and l.kc = pg_temp.norm(j.customer)
where l.dc is null
order by j.cases desc;
