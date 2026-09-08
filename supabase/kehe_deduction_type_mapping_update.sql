-- Updates Kehe deduction type mappings and normalizes existing Ksolve data.
-- Run this in the Supabase SQL editor after deploying the app code.

create or replace function pg_temp.kehe_type_key(value text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(replace(coalesce(value, ''), '&', 'and'), '[^A-Za-z0-9]+', '', 'g'));
$$;

create or replace function pg_temp.normalize_kehe_type(value text)
returns text
language plpgsql
immutable
as $$
declare
  cleaned text := btrim(regexp_replace(coalesce(value, ''), '\s+', ' ', 'g'));
  key text := pg_temp.kehe_type_key(value);
begin
  if cleaned = '' or key = 'blank' then
    return '';
  end if;

  if key in ('kehecustomerspoilsallowance', 'customerspoilsallowance', 'customerspoilagenatural', 'customerspoilage') then
    return 'Kehe Customer Spoils Allowance';
  end if;

  if key in ('kehewminvoice', 'targetswminvoice', 'wminvoice') then
    return 'Kehe WM Invoice';
  end if;

  if key in ('keheedlcallowance', 'edlcallowance') then
    return 'Kehe EDLC Allowance';
  end if;

  if key in ('kehepromoandplacementfunds', 'ppf') then
    return 'Kehe Promo & Placement Funds';
  end if;

  if key in ('promoandplacementfund', 'promoandplacementfunds', '1promotion', '1dollarpromotion', 'distributorcharge', 'kehetprfunding')
    or key like '%promoandplacementfund%'
    or key like '%1promotion%'
  then
    return 'Kehe TPR Funding';
  end if;

  if key in ('mcbpromotion', 'kehedistributionmcballowances', 'distributionmcballowances')
    or key like '%mcbpromotion%'
    or key like '%distributionmcballowance%'
  then
    return 'Kehe Distribution (MCB) Allowances';
  end if;

  if key in ('newitemsetupfee', 'newitemsetup', 'kehenewitemsetupfee')
    or key like '%newitemsetup%'
  then
    return 'Kehe New Item Setup Fee';
  end if;

  if key in ('introductionallowance', 'introallowanceaudit', 'introductoryfee', 'keheintroductionallowance')
    or key like '%introallowanceaudit%'
    or key like '%introductionallowance%'
    or key like '%introductoryfee%'
  then
    return 'Kehe Introduction Allowance';
  end if;

  if key in ('passthrudeduction', 'passthroughdeduction') then
    return '';
  end if;

  return cleaned;
end;
$$;

with mappings(original_type, new_type) as (
  values
    ('Kehe Customer Spoils Allowance', 'Kehe Customer Spoils Allowance'),
    ('Kehe WM Invoice', 'Kehe WM Invoice'),
    ('Promo and Placement Fund', 'Kehe TPR Funding'),
    ('New Item Setup Fee', 'Kehe New Item Setup Fee'),
    ('Introduction Allowance', 'Kehe Introduction Allowance'),
    ('$1 Promotion', 'Kehe TPR Funding'),
    ('MCB Promotion', 'Kehe Distribution (MCB) Allowances'),
    ('KeHE New Item Setup Fee', 'Kehe New Item Setup Fee'),
    ('WM Invoice', 'Kehe WM Invoice'),
    ('Customer Spoils Allowance', 'Kehe Customer Spoils Allowance'),
    ('Kehe EDLC Allowance', 'Kehe EDLC Allowance'),
    ('Kehe Promo & Placement Funds', 'Kehe Promo & Placement Funds')
)
update public.deduction_types existing
set
  deduction_type = mappings.new_type,
  updated_at = now()
from mappings
where pg_temp.kehe_type_key(existing.document_type) = pg_temp.kehe_type_key(mappings.original_type)
  and existing.deduction_type is distinct from mappings.new_type;

with mappings(original_type, new_type) as (
  values
    ('Kehe Customer Spoils Allowance', 'Kehe Customer Spoils Allowance'),
    ('Kehe WM Invoice', 'Kehe WM Invoice'),
    ('Promo and Placement Fund', 'Kehe TPR Funding'),
    ('New Item Setup Fee', 'Kehe New Item Setup Fee'),
    ('Introduction Allowance', 'Kehe Introduction Allowance'),
    ('$1 Promotion', 'Kehe TPR Funding'),
    ('MCB Promotion', 'Kehe Distribution (MCB) Allowances'),
    ('KeHE New Item Setup Fee', 'Kehe New Item Setup Fee'),
    ('WM Invoice', 'Kehe WM Invoice'),
    ('Customer Spoils Allowance', 'Kehe Customer Spoils Allowance'),
    ('Kehe EDLC Allowance', 'Kehe EDLC Allowance'),
    ('Kehe Promo & Placement Funds', 'Kehe Promo & Placement Funds')
)
insert into public.deduction_types (document_type, deduction_type, updated_at)
select mappings.original_type, mappings.new_type, now()
from mappings
where not exists (
  select 1
  from public.deduction_types existing
  where pg_temp.kehe_type_key(existing.document_type) = pg_temp.kehe_type_key(mappings.original_type)
);

update public.deduction_types
set
  deduction_type = pg_temp.normalize_kehe_type(deduction_type),
  updated_at = now()
where deduction_type is distinct from pg_temp.normalize_kehe_type(deduction_type);

update public.invoices
set type = pg_temp.normalize_kehe_type(type)
where type is distinct from pg_temp.normalize_kehe_type(type);

update public.invoices
set type = case
  when upper(coalesce(invoice_number, '')) like 'MCB%' then 'Kehe Distribution (MCB) Allowances'
  when upper(coalesce(invoice_number, '')) like 'PPF%' then 'Kehe Promo & Placement Funds'
  when upper(coalesce(invoice_number, '')) like 'IA%' then 'Kehe Introduction Allowance'
  when upper(coalesce(invoice_number, '')) like 'KD%' then 'Kehe Distribution (MCB) Allowances'
  when upper(coalesce(invoice_number, '')) like 'KK%' then 'Kehe EDLC Allowance'
  else type
end
where coalesce(btrim(type), '') = ''
  and (
    upper(coalesce(invoice_number, '')) like 'MCB%'
    or upper(coalesce(invoice_number, '')) like 'PPF%'
    or upper(coalesce(invoice_number, '')) like 'IA%'
    or upper(coalesce(invoice_number, '')) like 'KD%'
    or upper(coalesce(invoice_number, '')) like 'KK%'
  );

update public.uploads
set category = pg_temp.normalize_kehe_type(category)
where category is distinct from pg_temp.normalize_kehe_type(category);

update public.uploads
set category = case
  when upper(coalesce(invoice, '')) like 'MCB%' then 'Kehe Distribution (MCB) Allowances'
  when upper(coalesce(invoice, '')) like 'PPF%' then 'Kehe Promo & Placement Funds'
  when upper(coalesce(invoice, '')) like 'IA%' then 'Kehe Introduction Allowance'
  when upper(coalesce(invoice, '')) like 'KD%' then 'Kehe Distribution (MCB) Allowances'
  when upper(coalesce(invoice, '')) like 'KK%' then 'Kehe EDLC Allowance'
  else category
end
where coalesce(btrim(category), '') = ''
  and (
    upper(coalesce(invoice, '')) like 'MCB%'
    or upper(coalesce(invoice, '')) like 'PPF%'
    or upper(coalesce(invoice, '')) like 'IA%'
    or upper(coalesce(invoice, '')) like 'KD%'
    or upper(coalesce(invoice, '')) like 'KK%'
  );

update public.broker_commission_datasets
set type = pg_temp.normalize_kehe_type(type)
where type is distinct from pg_temp.normalize_kehe_type(type);

update public.broker_commission_datasets
set type = case
  when upper(coalesce(invoice, '')) like 'MCB%' then 'Kehe Distribution (MCB) Allowances'
  when upper(coalesce(invoice, '')) like 'PPF%' then 'Kehe Promo & Placement Funds'
  when upper(coalesce(invoice, '')) like 'IA%' then 'Kehe Introduction Allowance'
  when upper(coalesce(invoice, '')) like 'KD%' then 'Kehe Distribution (MCB) Allowances'
  when upper(coalesce(invoice, '')) like 'KK%' then 'Kehe EDLC Allowance'
  else type
end
where coalesce(btrim(type), '') = ''
  and (
    upper(coalesce(invoice, '')) like 'MCB%'
    or upper(coalesce(invoice, '')) like 'PPF%'
    or upper(coalesce(invoice, '')) like 'IA%'
    or upper(coalesce(invoice, '')) like 'KD%'
    or upper(coalesce(invoice, '')) like 'KK%'
  );

select
  'invoices' as source,
  type,
  count(*) as rows
from public.invoices
group by type
union all
select
  'uploads' as source,
  category as type,
  count(*) as rows
from public.uploads
group by category
union all
select
  'broker_commission_datasets' as source,
  type,
  count(*) as rows
from public.broker_commission_datasets
group by type
order by source, type nulls first;
