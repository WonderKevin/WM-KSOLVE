-- Normalize Ksolve invoice types to the current Kehe-only labels.
-- This intentionally touches only the explicit stale labels requested:
-- customer spoils, WM/Target WM invoice, and pass-through deduction.

update public.invoices
set type = 'Kehe Customer Spoils Allowance'
where regexp_replace(lower(coalesce(type, '')), '[^a-z0-9]+', '', 'g') in (
  'customerspoilsallowance',
  'customerspoilagenatural',
  'customerspoilage'
);

update public.invoices
set type = 'Kehe WM Invoice'
where regexp_replace(lower(coalesce(type, '')), '[^a-z0-9]+', '', 'g') in (
  'wminvoice',
  'targetswminvoice',
  'kehewminvoice'
);

update public.invoices
set type = ''
where regexp_replace(lower(coalesce(type, '')), '[^a-z0-9]+', '', 'g') in (
  'passthrudeduction',
  'passthroughdeduction'
);

update public.uploads
set category = 'Kehe Customer Spoils Allowance'
where regexp_replace(lower(coalesce(category, '')), '[^a-z0-9]+', '', 'g') in (
  'customerspoilsallowance',
  'customerspoilagenatural',
  'customerspoilage'
);

update public.uploads
set category = 'Kehe WM Invoice'
where regexp_replace(lower(coalesce(category, '')), '[^a-z0-9]+', '', 'g') in (
  'wminvoice',
  'targetswminvoice',
  'kehewminvoice'
);

update public.uploads
set category = ''
where regexp_replace(lower(coalesce(category, '')), '[^a-z0-9]+', '', 'g') in (
  'passthrudeduction',
  'passthroughdeduction'
);

update public.broker_commission_datasets
set type = 'Kehe Customer Spoils Allowance'
where regexp_replace(lower(coalesce(type, '')), '[^a-z0-9]+', '', 'g') in (
  'customerspoilsallowance',
  'customerspoilagenatural',
  'customerspoilage'
);

update public.broker_commission_datasets
set type = 'Kehe WM Invoice'
where regexp_replace(lower(coalesce(type, '')), '[^a-z0-9]+', '', 'g') in (
  'wminvoice',
  'targetswminvoice',
  'kehewminvoice'
);

update public.broker_commission_datasets
set type = ''
where regexp_replace(lower(coalesce(type, '')), '[^a-z0-9]+', '', 'g') in (
  'passthrudeduction',
  'passthroughdeduction'
);

with upload_types as (
  select distinct on (upper(regexp_replace(coalesce(invoice, ''), '\s+', '', 'g')))
    upper(regexp_replace(coalesce(invoice, ''), '\s+', '', 'g')) as invoice_key,
    case
      when regexp_replace(lower(coalesce(category, '')), '[^a-z0-9]+', '', 'g') in (
        'customerspoilsallowance',
        'customerspoilagenatural',
        'customerspoilage'
      )
        then 'Kehe Customer Spoils Allowance'
      when regexp_replace(lower(coalesce(category, '')), '[^a-z0-9]+', '', 'g') in (
        'wminvoice',
        'targetswminvoice',
        'kehewminvoice'
      )
        then 'Kehe WM Invoice'
      when regexp_replace(lower(coalesce(category, '')), '[^a-z0-9]+', '', 'g') in (
        'passthrudeduction',
        'passthroughdeduction'
      )
        then ''
      else trim(category)
    end as next_type
  from public.uploads
  where nullif(trim(coalesce(invoice, '')), '') is not null
    and nullif(trim(coalesce(category, '')), '') is not null
    and regexp_replace(lower(coalesce(category, '')), '[^a-z0-9]+', '', 'g') <> 'invoicesummary'
  order by upper(regexp_replace(coalesce(invoice, ''), '\s+', '', 'g')), coalesce(uploaded_at, created_at) desc
)
update public.invoices as invoices
set type = upload_types.next_type
from upload_types
where upper(regexp_replace(coalesce(invoices.invoice_number, ''), '\s+', '', 'g')) = upload_types.invoice_key
  and coalesce(invoices.type, '') is distinct from upload_types.next_type;

with upload_types as (
  select distinct on (upper(regexp_replace(coalesce(invoice, ''), '\s+', '', 'g')))
    upper(regexp_replace(coalesce(invoice, ''), '\s+', '', 'g')) as invoice_key,
    case
      when regexp_replace(lower(coalesce(category, '')), '[^a-z0-9]+', '', 'g') in (
        'customerspoilsallowance',
        'customerspoilagenatural',
        'customerspoilage'
      )
        then 'Kehe Customer Spoils Allowance'
      when regexp_replace(lower(coalesce(category, '')), '[^a-z0-9]+', '', 'g') in (
        'wminvoice',
        'targetswminvoice',
        'kehewminvoice'
      )
        then 'Kehe WM Invoice'
      when regexp_replace(lower(coalesce(category, '')), '[^a-z0-9]+', '', 'g') in (
        'passthrudeduction',
        'passthroughdeduction'
      )
        then ''
      else trim(category)
    end as next_type
  from public.uploads
  where nullif(trim(coalesce(invoice, '')), '') is not null
    and nullif(trim(coalesce(category, '')), '') is not null
    and regexp_replace(lower(coalesce(category, '')), '[^a-z0-9]+', '', 'g') <> 'invoicesummary'
  order by upper(regexp_replace(coalesce(invoice, ''), '\s+', '', 'g')), coalesce(uploaded_at, created_at) desc
)
update public.broker_commission_datasets as datasets
set type = upload_types.next_type
from upload_types
where upper(regexp_replace(coalesce(datasets.invoice, ''), '\s+', '', 'g')) = upload_types.invoice_key
  and coalesce(datasets.type, '') is distinct from upload_types.next_type;
