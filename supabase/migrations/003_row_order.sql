-- Update: lets you drag rows into your own order.
-- Adds one column (sort_order) and numbers your existing rows 1, 2, 3… in the
-- order they were created, which is the order you see today.
-- It does not change or delete any other data. Safe to run more than once.
-- Run in Supabase: SQL Editor > New query > paste > Run.

alter table public.applications
  add column if not exists sort_order double precision;

update public.applications a
   set sort_order = numbered.n
  from (
    select id, row_number() over (partition by user_id order by created_at, id) as n
      from public.applications
  ) as numbered
 where a.id = numbered.id
   and a.sort_order is null;

create index if not exists applications_user_order_idx
  on public.applications (user_id, sort_order);

-- Ask the API to pick up the new column straight away.
notify pgrst, 'reload schema';
