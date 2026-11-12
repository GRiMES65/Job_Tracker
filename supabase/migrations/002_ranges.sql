-- Update: Base $, OTE $ and Size become ranges (min / max).
-- Only needed if you ran the ORIGINAL schema.sql before this change.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Existing values are carried over.

alter table public.applications
  add column if not exists base_min numeric,
  add column if not exists base_max numeric,
  add column if not exists ote_min  numeric,
  add column if not exists ote_max  numeric,
  add column if not exists size_min integer,
  add column if not exists size_max integer;

do $$
begin
  -- Single Base/OTE amounts become a one-value range (min = max).
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'applications' and column_name = 'base') then
    update public.applications set base_min = base, base_max = base where base is not null and base_min is null;
    alter table public.applications drop column base;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'applications' and column_name = 'ote') then
    update public.applications set ote_min = ote, ote_max = ote where ote is not null and ote_min is null;
    alter table public.applications drop column ote;
  end if;

  -- Size buckets like '51–200' or '5,000+' become numbers.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'applications' and column_name = 'size') then
    update public.applications
       set size_min = nullif(regexp_replace(split_part(replace(size, '–', '-'), '-', 1), '[^0-9]', '', 'g'), '')::integer,
           size_max = nullif(regexp_replace(split_part(replace(size, '–', '-'), '-', 2), '[^0-9]', '', 'g'), '')::integer
     where size is not null and size <> '' and size_min is null;
    alter table public.applications drop column size;
  end if;
end $$;

-- Ask the API to pick up the new columns straight away.
notify pgrst, 'reload schema';
