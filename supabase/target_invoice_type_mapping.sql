alter table public.target_invoices
  add column if not exists type text;

create index if not exists target_invoices_type_idx
  on public.target_invoices (type);

with mappings(document_type, deduction_type) as (
  values
    ('Vendor Income Funding', 'Target''s TPR Funding'),
    ('WM Invoice', 'Target''s WM Invoice'),
    ('P.O. SHIPPED EARLY/LATE', 'Target''s Distribution (MCB) Allowances'),
    ('Assessorial Charges', 'Target''s Distribution (MCB) Allowances')
)
update public.deduction_types existing
set
  deduction_type = mappings.deduction_type,
  updated_at = now()
from mappings
where lower(trim(existing.document_type)) = lower(trim(mappings.document_type));

with mappings(document_type, deduction_type) as (
  values
    ('Vendor Income Funding', 'Target''s TPR Funding'),
    ('WM Invoice', 'Target''s WM Invoice'),
    ('P.O. SHIPPED EARLY/LATE', 'Target''s Distribution (MCB) Allowances'),
    ('Assessorial Charges', 'Target''s Distribution (MCB) Allowances')
)
insert into public.deduction_types (document_type, deduction_type, updated_at)
select mappings.document_type, mappings.deduction_type, now()
from mappings
where not exists (
  select 1
  from public.deduction_types existing
  where lower(trim(existing.document_type)) = lower(trim(mappings.document_type))
);

update public.target_invoices target
set type = deduction.deduction_type
from public.deduction_types deduction
where lower(trim(target.reason_code_description)) = lower(trim(deduction.document_type))
  and (
    target.type is null
    or trim(target.type) = ''
    or target.type <> deduction.deduction_type
  );

update public.target_invoices
set month = to_char(check_date, 'FMMonth') || ' ''' || to_char(check_date, 'YY')
where check_date is not null
  and (
    month is null
    or month !~ '^[A-Za-z]+ ''[0-9]{2}$'
  );
