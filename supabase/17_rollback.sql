-- ============================================================
-- ROLLBACK for 17_mobile_push_and_phone_login.sql. NOT APPLIED.
-- Run in the SQL editor only if 17 must be undone. Safe to run twice.
--
-- Deploy order when rolling back: first stop using it (remove / undeploy the
-- Edge Functions phone-sign-in, delete-account, notify and the others, and
-- ship phone builds that no longer call register_expo_push_token), then run
-- this file. Otherwise phones get "function does not exist" errors.
--
-- What is LOST: every stored Expo push token (phones register again on the
-- next app start once 17 is back), the phone sign-in attempt counters, and
-- the deleted_at marks. Closed accounts keep all their data either way (closing
-- never erased anything); their Auth logins stay BANNED after this rollback:
-- lift a ban in the dashboard (Authentication -> Users) or with the landlord
-- app's "Reactivate account" before rolling back.
-- =============================================================

begin;

-- The restrictive "closed account cannot ..." policies (expo_push_tokens' are dropped with the table below).
do $$
declare t text; v text;
begin
  foreach t in array array[
    'profiles', 'payments', 'maintenance_requests', 'maintenance_updates', 'messages',
    'message_reads', 'move_out_notices', 'notifications', 'push_subscriptions'
  ] loop
    foreach v in array array['insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', t || ': closed account cannot ' || v, t);
    end loop;
  end loop;
end $$;

drop table if exists public.phone_login_attempts;
drop table if exists public.expo_push_tokens;   -- its policies go with it

drop function if exists public.reactivate_account(uuid);
drop function if exists public.delete_account(uuid);
drop function if exists public.caller_is_closed();
drop function if exists public.phone_sign_in_lookup(text, text);
drop function if exists public.register_expo_push_token(text, text);

-- The profile guard exactly as 08 defined it (without the deleted_at check).
create or replace function public.guard_profile_changes()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_service_role() or public.is_landlord() then return new; end if;
  if new.role is distinct from old.role or new.unit_id is distinct from old.unit_id then
    raise exception 'Not allowed to change role or unit';
  end if;
  return new;
end;
$$;

alter table public.profiles drop column if exists deleted_at;

-- pgcrypto / the extensions schema are left in place: Supabase ships them and
-- other code may use them.

commit;
