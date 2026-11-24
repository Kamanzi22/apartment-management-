-- ============================================================
-- MIGRATION 17 (DRAFT, NOT APPLIED): Expo push tokens for the phone apps,
-- and a phone-number sign-in lookup that only the server can use.
-- Apply after 16. Safe to run twice.
--
-- DRAFT: written 24 Nov 2026 by the backend-plan agent and not run anywhere
-- (no database was available). Review it, run supabase/tests/17_checks.sql
-- on a throwaway database, then apply it in the SQL editor.
-- Design notes: docs/mobile-backend-plan.md ("Expo push token registration",
-- "Phone-number sign-in").
-- ============================================================

-- digest() for the attempt keys below. Supabase already has pgcrypto in the
-- "extensions" schema; both lines are no-ops there.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

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
  if not exists (select 1 from public.profiles where id = v_uid) then
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
  where p.role = 'tenant' and p.phone is not null
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
