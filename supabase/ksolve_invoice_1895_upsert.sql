-- Upsert Ksolve invoice 1895 from C:\Users\admin\Downloads\for upload.xlsx
-- Run in Supabase SQL Editor if invoice 1895 exists in the duplicate check
-- but is not visible or has stale values in public.invoices.

insert into public.invoices (
  month,
  check_date,
  check_number,
  check_amt,
  invoice_number,
  invoice_amt,
  dc_name,
  status,
  type,
  doc_status
)
values (
  'July ''26',
  '07/31/2026',
  '1375242',
  129506.97,
  '1895',
  755.57,
  'AURORA, CO',
  'P - Paid',
  'WM Invoice',
  false
)
on conflict (invoice_number) do update
set
  month = excluded.month,
  check_date = excluded.check_date,
  check_number = excluded.check_number,
  check_amt = excluded.check_amt,
  invoice_amt = excluded.invoice_amt,
  dc_name = excluded.dc_name,
  status = excluded.status,
  type = coalesce(nullif(public.invoices.type, ''), excluded.type),
  doc_status = coalesce(public.invoices.doc_status, excluded.doc_status);

select
  id,
  month,
  check_date,
  check_number,
  check_amt,
  invoice_number,
  invoice_amt,
  dc_name,
  status,
  type,
  doc_status
from public.invoices
where invoice_number = '1895';
