-- Corrects invoice AB294812 after adding KeHE new item setup detection.
-- Run in the Supabase SQL editor if the existing row still shows WM Invoice.

with fix as (
  select 'KeHE New Item Setup Fee'::text as type_name
)
update public.invoices
set
  type = fix.type_name,
  doc_status = true
from fix
where upper(regexp_replace(coalesce(invoice_number, ''), '\s+', '', 'g')) = 'AB294812';

with fix as (
  select 'KeHE New Item Setup Fee'::text as type_name
)
update public.uploads
set category = fix.type_name
from fix
where upper(regexp_replace(coalesce(invoice, ''), '\s+', '', 'g')) = 'AB294812'
   or upper(coalesce(file_name, '')) like '%AB294812%';

with fix as (
  select 'KeHE New Item Setup Fee'::text as type_name
)
update public.broker_commission_datasets
set type = fix.type_name
from fix
where upper(regexp_replace(coalesce(invoice, ''), '\s+', '', 'g')) = 'AB294812';

select id, invoice_number, type, doc_status
from public.invoices
where upper(regexp_replace(coalesce(invoice_number, ''), '\s+', '', 'g')) = 'AB294812';
