-- Favorite teams, one per sport, set from the Account page. Run once after
-- accounts.sql. Safe to run again.

-- { "cfb": { "id": "333", "name": "Alabama", "logo": "https://a.espncdn.com/..." },
--   "nfl": {...}, "hoops": {...} }
alter table public.profiles add column if not exists favorites jsonb not null default '{}'::jsonb;

-- Sets or clears (p_team null) the signed-in account's favorite for a sport.
-- Only ESPN logo addresses and plain team names are accepted, so nothing
-- odd can end up on the leaderboards.
create or replace function public.set_favorite(p_sport text, p_team jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then raise exception 'Sign in first.'; end if;
  if p_sport not in ('cfb', 'nfl', 'hoops') then raise exception 'Unknown sport.'; end if;

  if p_team is null then
    update profiles set favorites = favorites - p_sport where user_id = uid returning favorites into result;
  else
    if coalesce(p_team->>'id', '') !~ '^[0-9]{1,8}$'
       or coalesce(p_team->>'name', '') !~ '^[[:alnum:] .''&()-]{1,40}$'
       or coalesce(p_team->>'logo', '') !~ '^https://a\.espncdn\.com/[A-Za-z0-9/_.-]+\.png$' then
      raise exception 'That team couldn''t be saved.';
    end if;
    update profiles
      set favorites = favorites || jsonb_build_object(p_sport,
        jsonb_build_object('id', p_team->>'id', 'name', p_team->>'name', 'logo', p_team->>'logo'))
      where user_id = uid returning favorites into result;
  end if;

  if result is null then raise exception 'Claim a name first.'; end if;
  return result;
end $$;
revoke all on function public.set_favorite(text, jsonb) from public;
grant execute on function public.set_favorite(text, jsonb) to authenticated;

-- New names: letters, numbers, spaces and a few symbols, so a name can't
-- carry anything that would break a page. Names already claimed keep theirs.
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

  -- The spelling already on the leaderboard, most recent first. An old name
  -- is allowed as it was; a new one has to use the plain characters.
  select user_name into spelling from (
    select user_name, created_at from picks where not is_host and squash_name(user_name) = squash_name(wanted)
    union all
    select user_name, created_at from nfl_picks where squash_name(user_name) = squash_name(wanted)
    union all
    select user_name, created_at from hoops_picks where squash_name(user_name) = squash_name(wanted)
  ) earlier order by created_at desc limit 1;

  if spelling is null and wanted !~ '^[A-Za-z0-9 @._''!?&-]+$' then
    raise exception 'Names can use letters, numbers, spaces and @ . _ - '' ! ? &';
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

  insert into profiles (user_id, display_name) values (uid, coalesce(spelling, wanted));
  return coalesce(spelling, wanted);
exception when unique_violation then
  raise exception 'That name is already claimed.';
end $$;
revoke all on function public.claim_name(text) from public;
grant execute on function public.claim_name(text) to authenticated;
