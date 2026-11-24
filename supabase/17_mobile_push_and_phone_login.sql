-- ============================================================
-- MIGRATION 17 (NOT APPLIED YET): what the phone apps need from the database.
--   1. expo_push_tokens + register_expo_push_token()   (Expo push)
--   2. phone_sign_in_lookup() + phone_login_attempts   (phone-number sign-in)
--   3. profiles.deleted_at + delete_account()           (in-app account deletion)
-- Apply after 16. Safe to run twice. Undo: supabase/17_rollback.sql.
--
-- Written 24-25 Nov 2026 by the backend agent. Plain-English explanation of
-- every part: docs/migration-17.md. Before applying: run
-- supabase/tests/17_checks.sql on a THROWAWAY database (never production).
-- Every SECURITY DEFINER function here has search_path = '' and is not
-- executable by anon; the server-only ones are executable by service_role only.
-- ============================================================

-- digest() for the attempt keys below. Supabase already has pgcrypto in the
-- "extensions" schema; both lines are no-ops there.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- When a tenant deleted their account from the phone (section 3). Null for
-- everyone else. Set only by delete_account() (service role).
alter table public.profiles add column if not exists deleted_at timestamptz;

-- Tenants may update their own profile row (01), so the guard from 08 now also
-- keeps them from setting or clearing deleted_at. Same body as 08 plus that one
-- column; is_service_role() / is_landlord() pass as before.
create or replace function public.guard_profile_changes()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_service_role() or public.is_landlord() then return new; end if;
  if new.role is distinct from old.role or new.unit_id is distinct from old.unit_id then
    raise exception 'Not allowed to change role or unit';
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    raise exception 'Not allowed to change deleted_at';
  end if;
  return new;
end;
$$;

-- ── 1. Expo push tokens ──────────────────────────────────────
-- One row per installed app. push_subscriptions (12) stays for web push:
-- it is shaped for VAPID (endpoint + keys), an Expo token is one string.
create table if not exists public.expo_push_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  token        text not null unique
               check (token ~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$'),
  platform     text not null check (platform in ('ios', 'android')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists expo_push_tokens_user_idx on public.expo_push_tokens (user_id);
alter table public.expo_push_tokens enable row level security;

-- Own rows only. There is deliberately no landlord policy: the landlord app
-- never reads tenants' tokens. Sending is done by the Edge Function with the
-- secret key (service_role bypasses RLS).
drop policy if exists "expo_push_tokens: own" on public.expo_push_tokens;
drop policy if exists "expo_push_tokens: read own" on public.expo_push_tokens;
create policy "expo_push_tokens: read own" on public.expo_push_tokens for select
  using (user_id = auth.uid());
drop policy if exists "expo_push_tokens: add own" on public.expo_push_tokens;
create policy "expo_push_tokens: add own" on public.expo_push_tokens for insert
  with check (user_id = auth.uid());
drop policy if exists "expo_push_tokens: remove own" on public.expo_push_tokens;
create policy "expo_push_tokens: remove own" on public.expo_push_tokens for delete
  using (user_id = auth.uid());

-- Supabase grants everything on new public tables to anon and authenticated
-- by default. Signed-out visitors get nothing; signed-in users get exactly
-- the three verbs the policies above cover (no UPDATE: use the function below).
revoke all on public.expo_push_tokens from public, anon;
revoke all on public.expo_push_tokens from authenticated;
grant select, insert, delete on public.expo_push_tokens to authenticated;
grant all on public.expo_push_tokens to service_role;

-- Registering on app start / sign-in. A plain upsert is not enough: if the
-- phone was used by another account before (shared phone, sign out + sign in
-- as someone else), that user's row holds the same token and RLS hides it,
-- so the insert would fail on the unique index. This moves the token over,
-- like savePushSubscription() does for web push with the admin client.
create or replace function public.register_expo_push_token(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and deleted_at is null) then
    raise exception 'Account not configured' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$' then
    raise exception 'Invalid Expo push token' using errcode = '22023';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception 'Platform must be ios or android' using errcode = '22023';
  end if;

  insert into public.expo_push_tokens (user_id, token, platform)
  values (v_uid, p_token, p_platform)
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        last_seen_at = now(),
        -- a token that changes hands counts as a new registration
        created_at = case when public.expo_push_tokens.user_id = excluded.user_id
                          then public.expo_push_tokens.created_at else now() end;
end;
$$;
revoke execute on function public.register_expo_push_token(text, text) from public, anon;
grant execute on function public.register_expo_push_token(text, text) to authenticated, service_role;


-- ── 2. Phone-number sign-in lookup ───────────────────────────
-- The phone apps must not receive anyone's email, and must not be able to
-- tell whether a number is registered. So the lookup is only callable by
-- service_role: the "phone-sign-in" Edge Function calls it, signs in with
-- the email server-side, and returns only the session (or one generic error).
--
-- Normalisation matches tenantEmailForPhone() in the tenant web app
-- (src/app/actions/auth.ts): keep digits only, at least 6 of them, compare
-- with the tenant's profiles.phone reduced to digits, and use it only when
-- exactly one tenant matches. "+250 788 123 456" and "0788123456" are
-- therefore different numbers, exactly as on the web today.
--
-- Rate limiting: every lookup is counted per number and per caller (the
-- Edge Function passes a hash of the client IP, never the IP itself).
-- Attempts are counted whether or not the number exists, so the limit
-- itself reveals nothing.

create table if not exists public.phone_login_attempts (
  id         bigint generated always as identity primary key,
  phone_key  text not null,           -- sha256 of the normalised digits
  client_key text,                    -- sha256 of the client IP, from the Edge Function
  at         timestamptz not null default now()
);
create index if not exists phone_login_attempts_phone_idx on public.phone_login_attempts (phone_key, at desc);
create index if not exists phone_login_attempts_client_idx on public.phone_login_attempts (client_key, at desc);
alter table public.phone_login_attempts enable row level security;
-- No policies: only service_role (which bypasses RLS) reads or writes it.
revoke all on public.phone_login_attempts from public, anon, authenticated;
grant all on public.phone_login_attempts to service_role;

-- Returns at most one row:
--   limited = true  -> too many attempts; email is null whatever the number
--   limited = false -> email is the tenant's login email, or null
-- The Edge Function turns "email is null" and "wrong password" into the same
-- message, and "limited" into "Too many attempts, try again later".
create or replace function public.phone_sign_in_lookup(p_phone text, p_client_key text default null)
returns table (email text, limited boolean)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_phone_key text;
  v_ids uuid[];
begin
  if length(v_digits) < 6 or length(v_digits) > 20 then
    return query select null::text, false;
    return;
  end if;
  v_phone_key := encode(extensions.digest(v_digits, 'sha256'), 'hex');

  -- 5 tries per number per 15 minutes, 30 per caller per hour.
  if (select count(*) from public.phone_login_attempts a
       where a.phone_key = v_phone_key and a.at > now() - interval '15 minutes') >= 5
     or (p_client_key is not null and
         (select count(*) from public.phone_login_attempts a
           where a.client_key = p_client_key and a.at > now() - interval '1 hour') >= 30) then
    return query select null::text, true;
    return;
  end if;

  insert into public.phone_login_attempts (phone_key, client_key) values (v_phone_key, p_client_key);
  -- Keep the table small.
  delete from public.phone_login_attempts where at < now() - interval '1 day';

  select array_agg(p.id) into v_ids
  from public.profiles p
  where p.role = 'tenant' and p.phone is not null and p.deleted_at is null
    and regexp_replace(p.phone, '\D', '', 'g') = v_digits;

  if coalesce(array_length(v_ids, 1), 0) <> 1 then
    return query select null::text, false;
    return;
  end if;

  return query
    select u.email::text, false
    from auth.users u
    where u.id = v_ids[1];
  if not found then
    return query select null::text, false;
  end if;
end;
$$;
revoke execute on function public.phone_sign_in_lookup(text, text) from public, anon, authenticated;
grant execute on function public.phone_sign_in_lookup(text, text) to service_role;


-- ── 3. Account deletion ──────────────────────────────────────
-- Called only by the "delete-account" Edge Function (service role), with the
-- user id taken from the caller's verified JWT, after the password was
-- re-entered and the login was banned. The function then deletes or
-- soft-deletes the Auth login itself (auth.admin.deleteUser).
--
-- Why not a plain hard delete: profiles -> auth.users is ON DELETE CASCADE,
-- and leases, payments, maintenance requests, move-out notices and messages
-- all cascade from profiles. Hard-deleting a tenant who ever rented would
-- wipe the landlord's rent history and accounts for that unit.
--
-- So:
--   * landlord                     -> refused (it would orphan the building)
--   * no profile                   -> 'deleted' (only the Auth login exists)
--   * tenant with no records       -> profile deleted (cascades its few rows),
--                                     'deleted' -> the function hard-deletes the login
--   * tenant with any lease, payment, repair, move-out or vacate notice
--                                  -> 'anonymised': personal rows deleted, name
--                                     and phone removed, own message texts
--                                     replaced, records kept; the function
--                                     soft-deletes the login (row kept, so the
--                                     cascade never fires)
-- Safe to call twice (a retry after a partial failure gives the same result).
create or replace function public.delete_account(p_user uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_role text;
  v_lease_id uuid;
  v_unit_id uuid;
  v_unit_label text;
  v_landlord uuid;
begin
  if p_user is null then
    raise exception 'User is required' using errcode = '22023';
  end if;

  select p.role into v_role from public.profiles p where p.id = p_user for update;
  if not found then
    return jsonb_build_object('mode', 'deleted', 'landlord_id', null, 'unit_label', null, 'had_active_lease', false);
  end if;
  if v_role = 'landlord' then
    raise exception 'Landlord accounts cannot be deleted from the app' using errcode = '42501';
  end if;

  if not (exists (select 1 from public.leases where tenant_id = p_user)
       or exists (select 1 from public.payments where tenant_id = p_user)
       or exists (select 1 from public.maintenance_requests where tenant_id = p_user)
       or exists (select 1 from public.move_out_notices where tenant_id = p_user)
       or exists (select 1 from public.vacate_notices where tenant_id = p_user)) then
    -- Nothing anyone else needs: the cascade removes notifications, messages,
    -- message_reads, push_subscriptions, expo_push_tokens, alert rows.
    delete from public.profiles where id = p_user;
    return jsonb_build_object('mode', 'deleted', 'landlord_id', null, 'unit_label', null, 'had_active_lease', false);
  end if;

  -- A lease still running: the landlord gets told (by the Edge Function) and
  -- ends the tenancy as usual. The lease itself is left as it is.
  select l.id, l.unit_id into v_lease_id, v_unit_id
    from public.leases l
   where l.tenant_id = p_user and l.status = 'active'
   order by l.lease_start desc
   limit 1;
  if v_lease_id is not null then
    select u.label into v_unit_label from public.units u where u.id = v_unit_id;
    select p.id into v_landlord from public.profiles p where p.role = 'landlord' order by p.created_at limit 1;
  end if;

  -- Personal rows nobody else needs.
  delete from public.expo_push_tokens  where user_id = p_user;
  delete from public.push_subscriptions where user_id = p_user;
  delete from public.notifications     where user_id = p_user;
  delete from public.message_reads     where user_id = p_user;
  -- The tenant's own words in direct messages: the row stays (the landlord's
  -- thread keeps its shape and dates), the text goes. The landlord's own
  -- messages and maintenance texts are kept (repair records).
  update public.messages set body = '(message deleted by the tenant)'
   where sender_id = p_user and body <> '(message deleted by the tenant)';
  -- Kept: leases, rent_schedule, payments (+ receipt files), maintenance
  -- requests / updates / history, move-out and vacate notices, sent_alerts.
  update public.profiles
     set full_name = 'Former tenant (deleted)',
         phone = null,
         email_notifications = false,
         deleted_at = coalesce(deleted_at, now())
   where id = p_user;

  return jsonb_build_object('mode', 'anonymised', 'landlord_id', v_landlord,
                            'unit_label', v_unit_label, 'had_active_lease', v_lease_id is not null);
end;
$$;
revoke execute on function public.delete_account(uuid) from public, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;
