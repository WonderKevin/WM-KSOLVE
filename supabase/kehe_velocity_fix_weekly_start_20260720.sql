-- Fixes weekly KeHE Velocity rows saved by the old single "week ending date" input,
-- which forced period_start_date = period_end_date - 6 days (a full 7-day week).
-- Commit 4cdb726 fixed the upload flow to store the actual From date, but rows
-- inserted before that deploy still carry the snapped start date.
--
-- This corrects the reported week: end 06/30/2026 should start 06/29/2026, not 06/24/2026.
-- Review the SELECT output first, then run the UPDATE.

begin;

-- 1. Inspect the affected row(s) before changing anything.
select id, retailer, customer, month, period_type, period_start_date, period_end_date
from public.kehe_velocity
where period_type = 'weekly'
  and period_end_date = date '2026-06-30'
  and period_start_date = date '2026-06-24';

-- 2. Correct the start date for that specific week.
update public.kehe_velocity
set period_start_date = date '2026-06-29'
where period_type = 'weekly'
  and period_end_date = date '2026-06-30'
  and period_start_date = date '2026-06-24';

commit;
