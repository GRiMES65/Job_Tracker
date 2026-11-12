-- Job Tracker database setup.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
--
-- Security model: every row belongs to the user who created it (user_id),
-- and Row Level Security only lets a signed-in user touch their own rows.
-- Logged-out visitors (the "anon" role) get no access at all.

create table if not exists public.applications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company     text not null default '',
  role        text not null default '',
  status      text not null default 'Saved'
              check (status in ('Saved','Applied','Screen','Interview','Offer','Rejected','Ghosted')),
  base_min    numeric,
  base_max    numeric,
  ote_min     numeric,
  ote_max     numeric,
  size_min    integer,
  size_max    integer,
  rating      numeric check (rating is null or (rating >= 0 and rating <= 5)),
  founded     integer,
  funding     text,
  location    text,
  mode        text,
  link        text,
  reviews     text,
  applied     date,
  follow_up   date,
  source      text,
  contact     text,
  resume      text,
  fit         text default '2',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists applications_user_id_idx on public.applications (user_id);

-- Keep updated_at current on every edit.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists applications_set_updated_at on public.applications;
create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

-- Lock the table down.
alter table public.applications enable row level security;
alter table public.applications force row level security;

revoke all on public.applications from anon;
grant select, insert, update, delete on public.applications to authenticated;

drop policy if exists "Owner can read"   on public.applications;
drop policy if exists "Owner can insert" on public.applications;
drop policy if exists "Owner can update" on public.applications;
drop policy if exists "Owner can delete" on public.applications;

create policy "Owner can read" on public.applications
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Owner can insert" on public.applications
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Owner can update" on public.applications
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Owner can delete" on public.applications
  for delete to authenticated
  using ((select auth.uid()) = user_id);
