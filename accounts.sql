-- Accounts: every new entry needs a signed-in listener, under the name
-- their account claimed. Run once after lockdown.sql. Safe to run again.

-- 1. Each account's name. Claimed once, through claim_name() below.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_one_per_name on public.profiles (lower(display_name));

alter table public.profiles enable row level security;
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles' loop
    execute format('drop policy %I on public.profiles', p.policyname);
  end loop;
end $$;
create policy "Anyone can read names" on public.profiles for select using (true);
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;

-- 2. Site admins: can save host picks, and their name is held for them.
create table if not exists public.site_admins (
  email text primary key,
  display_name text
);
alter table public.site_admins enable row level security;
revoke all on public.site_admins from anon, authenticated;
insert into public.site_admins (email, display_name) values ('xliquidflames@gmail.com', 'Liquid')
  on conflict (email) do update set display_name = excluded.display_name;

-- True when the signed-in account's confirmed email is a site admin's.
create or replace function public.is_site_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from auth.users u
    join public.site_admins a on lower(a.email) = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;
revoke all on function public.is_site_admin() from public;
grant execute on function public.is_site_admin() to anon, authenticated;

-- Names compare without case, spaces or a leading @, like the old name check.
create or replace function public.squash_name(n text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(lower(btrim(coalesce(n, ''))), '^@', ''), '\s', '', 'g');
$$;

-- 3. Claim a name. Someone who played before types their old name and
--    keeps its exact spelling, so their season record carries over.
create or replace function public.claim_name(p_name text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
  wanted text := btrim(coalesce(p_name, ''));
  mine text;
  spelling text;
begin
  if uid is null then raise exception 'Sign in first.'; end if;

  select display_name into mine from profiles where user_id = uid;
  if mine is not null then return mine; end if;

  if char_length(wanted) < 2 or char_length(wanted) > 30 then
    raise exception 'Names are 2 to 30 characters.';
  end if;
  if exists (select 1 from profiles where squash_name(display_name) = squash_name(wanted)) then
    raise exception 'That name is already claimed.';
  end if;
  if exists (select 1 from site_admins where squash_name(display_name) = squash_name(wanted))
     and not is_site_admin() then
    raise exception 'That name is already claimed.';
  end if;
  if exists (select 1 from picks where is_host and squash_name(user_name) = squash_name(wanted)) then
    raise exception 'That name belongs to a host.';
  end if;

  -- The spelling already on the leaderboard, most recent first.
  select user_name into spelling from (
    select user_name, created_at from picks where not is_host and squash_name(user_name) = squash_name(wanted)
    union all
    select user_name, created_at from nfl_picks where squash_name(user_name) = squash_name(wanted)
    union all
    select user_name, created_at from hoops_picks where squash_name(user_name) = squash_name(wanted)
  ) earlier order by created_at desc limit 1;

  insert into profiles (user_id, display_name) values (uid, coalesce(spelling, wanted));
  return coalesce(spelling, wanted);
exception when unique_violation then
  raise exception 'That name is already claimed.';
end $$;
revoke all on function public.claim_name(text) from public;
grant execute on function public.claim_name(text) to authenticated;

-- 4. Entries belong to the account that sent them. Older entries keep an
--    empty account and still count under their name.
alter table public.picks add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.nfl_picks add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.hoops_picks add column if not exists user_id uuid default auth.uid() references auth.users (id) on delete set null;

do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename in ('picks', 'nfl_picks', 'hoops_picks') loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

create policy "Anyone can read picks" on public.picks for select using (true);
create policy "Anyone can read NFL picks" on public.nfl_picks for select using (true);
create policy "Anyone can read hoops picks" on public.hoops_picks for select using (true);

-- Signed in, as yourself, under your claimed name.
create policy "Players submit their own picks" on public.picks for insert to authenticated
  with check (is_host = false and user_id = auth.uid()
              and user_name = (select display_name from public.profiles where user_id = auth.uid()));
create policy "Players submit their own NFL picks" on public.nfl_picks for insert to authenticated
  with check (user_id = auth.uid()
              and user_name = (select display_name from public.profiles where user_id = auth.uid()));
create policy "Players submit their own hoops picks" on public.hoops_picks for insert to authenticated
  with check (user_id = auth.uid()
              and user_name = (select display_name from public.profiles where user_id = auth.uid()));

revoke insert, update, delete, truncate on public.picks, public.nfl_picks, public.hoops_picks from anon;
revoke update, delete, truncate on public.picks, public.nfl_picks, public.hoops_picks from authenticated;
grant select on public.picks, public.nfl_picks, public.hoops_picks to anon, authenticated;
grant insert on public.picks, public.nfl_picks, public.hoops_picks to authenticated;

-- 5. Host picks: saved by a site admin's account instead of a PIN.
drop function if exists public.save_host_picks(text, text, integer, jsonb);
drop table if exists public.host_pin;

create or replace function public.save_host_picks(p_name text, p_week integer, p_picks jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_site_admin() then
    raise exception 'This account can''t save host picks.';
  end if;
  update picks set picks = p_picks, created_at = now()
    where lower(user_name) = lower(p_name) and week_number = p_week and is_host;
  if not found then
    insert into picks (user_name, week_number, is_host, picks, user_id) values (p_name, p_week, true, p_picks, null);
  end if;
end $$;
revoke all on function public.save_host_picks(text, integer, jsonb) from public;
grant execute on function public.save_host_picks(text, integer, jsonb) to authenticated;
