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
