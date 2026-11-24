-- Checks for 17_mobile_push_and_phone_login.sql (not applied yet).
--
-- NEVER run this against production. Run it in a THROWAWAY database that has
-- the migrations applied: a Supabase branch / local stack, or a plain
-- Postgres 16 with tests/supabase_stubs.sql + 01..17 applied.
-- Everything happens inside one transaction that is rolled back, so it leaves
-- nothing behind. Any failed check stops the script with an error that names it.
--
--   psql "$THROWAWAY_URL" -v ON_ERROR_STOP=1 -f supabase/tests/17_checks.sql
--
-- Run status: see docs/migration-17.md ("How it was checked").

begin;

-- ── Test people (as the migration owner, so no RLS) ──────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'check17-landlord@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'check17-tenant-a@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'check17-tenant-b@example.test'),
  ('00000000-0000-0000-0000-0000000000a4', 'check17-tenant-c@example.test'),
  ('00000000-0000-0000-0000-0000000000a5', 'check17-tenant-d@example.test');
insert into public.profiles (id, role, full_name, phone) values
  ('00000000-0000-0000-0000-0000000000a1', 'landlord', 'Check Landlord', null),
  ('00000000-0000-0000-0000-0000000000a2', 'tenant', 'Check Tenant A', '+250 788 000 111'),
  ('00000000-0000-0000-0000-0000000000a3', 'tenant', 'Check Tenant B', '0788-000-222'),
  -- C and D share a number: the lookup must refuse to pick one.
  ('00000000-0000-0000-0000-0000000000a4', 'tenant', 'Check Tenant C', '0788 000 333'),
  ('00000000-0000-0000-0000-0000000000a5', 'tenant', 'Check Tenant D', '(0788) 000-333');

insert into public.expo_push_tokens (user_id, token, platform) values
  ('00000000-0000-0000-0000-0000000000a2', 'ExponentPushToken[check17AAAAAAAAAAAA]', 'ios'),
  ('00000000-0000-0000-0000-0000000000a3', 'ExponentPushToken[check17BBBBBBBBBBBB]', 'android');

-- ── 1. Tenant A sees only A's token, cannot touch B's ─────────
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);

do $$
begin
  assert (select count(*) from public.expo_push_tokens) = 1,
    '1a: tenant A must see exactly one token (their own)';
  assert not exists (select 1 from public.expo_push_tokens
                      where user_id = '00000000-0000-0000-0000-0000000000a3'),
    '1b: tenant A must not see tenant B''s token';

  delete from public.expo_push_tokens where token = 'ExponentPushToken[check17BBBBBBBBBBBB]';
  -- RLS hides B's row, so the delete matches nothing (checked in 5g as owner).

  begin
    insert into public.expo_push_tokens (user_id, token, platform)
    values ('00000000-0000-0000-0000-0000000000a3', 'ExponentPushToken[check17XXXXXXXXXXXX]', 'ios');
    raise exception '1c: tenant A inserted a token for tenant B';
  exception when insufficient_privilege then null;  -- RLS with check: 42501
  end;

  begin
    update public.expo_push_tokens set last_seen_at = now();
    raise exception '1d: tenant A was allowed to UPDATE tokens directly';
  exception when insufficient_privilege then null;  -- no UPDATE grant
  end;

  -- Own token through the function: fine, and idempotent.
  perform public.register_expo_push_token('ExponentPushToken[check17AAAAAAAAAAAA]', 'ios');
  perform public.register_expo_push_token('ExponentPushToken[check17AAAAAAAAAAAA]', 'ios');
  assert (select count(*) from public.expo_push_tokens) = 1, '1e: re-registering must not duplicate';

  begin
    perform public.register_expo_push_token('not-a-token', 'ios');
    raise exception '1f: an invalid token was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ── 2. The landlord cannot read tenants' tokens ───────────────
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
begin
  assert (select count(*) from public.expo_push_tokens) = 0,
    '2: the landlord must not see any tenant token';
end $$;

-- ── 3. Shared phone: B signs in on A's phone, the token moves to B ─
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
do $$
begin
  perform public.register_expo_push_token('ExponentPushToken[check17AAAAAAAAAAAA]', 'ios');
  assert exists (select 1 from public.expo_push_tokens
                  where token = 'ExponentPushToken[check17AAAAAAAAAAAA]'
                    and user_id = '00000000-0000-0000-0000-0000000000a3'),
    '3: the token must now belong to tenant B';
end $$;

-- ── 4. Signed-out visitors get nothing ────────────────────────
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin
    perform 1 from public.expo_push_tokens;
    raise exception '4a: anon could select from expo_push_tokens';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.expo_push_tokens (user_id, token, platform)
    values ('00000000-0000-0000-0000-0000000000a2', 'ExponentPushToken[check17ANONANONANON]', 'ios');
    raise exception '4b: anon could insert into expo_push_tokens';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.register_expo_push_token('ExponentPushToken[check17ANONANONANON]', 'ios');
    raise exception '4c: anon could call register_expo_push_token';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.phone_login_attempts;
    raise exception '4d: anon could read phone_login_attempts';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── 5. The phone lookup is not callable by anon or authenticated ─
reset role;
do $$
begin
  assert not has_function_privilege('anon', 'public.phone_sign_in_lookup(text, text)', 'execute'),
    '5a: anon must not have EXECUTE on phone_sign_in_lookup';
  assert not has_function_privilege('authenticated', 'public.phone_sign_in_lookup(text, text)', 'execute'),
    '5b: authenticated must not have EXECUTE on phone_sign_in_lookup';
  assert has_function_privilege('service_role', 'public.phone_sign_in_lookup(text, text)', 'execute'),
    '5c: service_role must have EXECUTE on phone_sign_in_lookup';
  assert not has_table_privilege('authenticated', 'public.phone_login_attempts', 'select'),
    '5d: authenticated must not read phone_login_attempts';
  assert exists (select 1 from public.expo_push_tokens
                  where token = 'ExponentPushToken[check17BBBBBBBBBBBB]'),
    '5g: tenant A''s delete in 1 must not have removed tenant B''s token';
end $$;

set local role anon;
do $$
begin
  begin
    perform public.phone_sign_in_lookup('0788000111');
    raise exception '5e: anon could call phone_sign_in_lookup';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.phone_sign_in_lookup('0788000222');
    raise exception '5f: a signed-in tenant could call phone_sign_in_lookup';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── 6. What the lookup returns for the service role ───────────
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare r record;
begin
  -- Same digits as the web: "+250 788 000 111" -> 250788000111.
  select * into r from public.phone_sign_in_lookup('250788000111', 'client-1');
  assert r.email = 'check17-tenant-a@example.test' and not r.limited, '6a: exact digits match tenant A';
  select * into r from public.phone_sign_in_lookup('0788 000 222', 'client-1');
  assert r.email = 'check17-tenant-b@example.test', '6b: spaces and dashes are ignored';
  select * into r from public.phone_sign_in_lookup('0788000111', 'client-1');
  assert r.email is null, '6c: 0788... is not +250 788... (same rule as the web)';
  select * into r from public.phone_sign_in_lookup('0788000333', 'client-1');
  assert r.email is null, '6d: two tenants with one number -> no match';
  select * into r from public.phone_sign_in_lookup('12345', 'client-1');
  assert r.email is null and not r.limited, '6e: fewer than 6 digits -> no match';
  select * into r from public.phone_sign_in_lookup('0799999999', 'client-1');
  assert r.email is null, '6f: unknown number -> no match';

  -- Rate limit: 5 per number per 15 minutes (6f already used 1 for 0799999999).
  perform public.phone_sign_in_lookup('0799999999', 'client-2') from generate_series(1, 4);
  select * into r from public.phone_sign_in_lookup('0799999999', 'client-3');
  assert r.limited and r.email is null, '6g: 6th try on one number is limited';
  -- ...and the limit looks the same for a number that does exist.
  perform public.phone_sign_in_lookup('0788000222', 'client-4') from generate_series(1, 4);
  select * into r from public.phone_sign_in_lookup('0788000222', 'client-5');
  assert r.limited and r.email is null, '6h: a real number is limited the same way';
end $$;

reset role;

-- ── 7. Account deletion (delete_account) ─────────────────────
-- Tenant E rented (lease, payment, messages, token, alert): must be anonymised,
-- records kept. Tenant F never rented: must be deleted completely.
-- Tenant G is only used to check that a deleted profile's phone stops matching.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);  -- lets the payment guard accept the test row
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'check17-tenant-e@example.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'check17-tenant-f@example.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'check17-tenant-g@example.test');
insert into public.units (id, label, bedroom_count, monthly_rent, status) values
  ('00000000-0000-0000-0000-0000000000b7', 'Check17 Unit', 1, 300000, 'occupied');
insert into public.profiles (id, role, full_name, phone, unit_id) values
  ('00000000-0000-0000-0000-0000000000e1', 'tenant', 'Check Tenant E', '0788 000 555', '00000000-0000-0000-0000-0000000000b7'),
  ('00000000-0000-0000-0000-0000000000f1', 'tenant', 'Check Tenant F', null, null),
  ('00000000-0000-0000-0000-0000000000f2', 'tenant', 'Check Tenant G', '0788 000 777', null);
insert into public.leases (id, unit_id, tenant_id, move_in_date, rent_due_day, monthly_rent, lease_start, status) values
  ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000b7',
   '00000000-0000-0000-0000-0000000000e1', '2026-01-01', 1, 300000, '2026-01-01', 'active');
insert into public.payments (lease_id, tenant_id, period_month, amount, status) values
  ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000e1', '2026-01', 300000, 'confirmed');
insert into public.messages (sender_id, recipient_id, body) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'check17 tenant words'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'check17 landlord words');
insert into public.notifications (user_id, type, title, body) values
  ('00000000-0000-0000-0000-0000000000e1', 'general', 'x', 'x'),
  ('00000000-0000-0000-0000-0000000000f1', 'general', 'x', 'x');
insert into public.expo_push_tokens (user_id, token, platform) values
  ('00000000-0000-0000-0000-0000000000e1', 'ExponentPushToken[check17EEEEEEEEEEEE]', 'ios'),
  ('00000000-0000-0000-0000-0000000000f1', 'ExponentPushToken[check17FFFFFFFFFFFF]', 'android');
select set_config('request.jwt.claims', '', true);

do $$
begin
  assert not has_function_privilege('anon', 'public.delete_account(uuid)', 'execute'),
    '7a: anon must not have EXECUTE on delete_account';
  assert not has_function_privilege('authenticated', 'public.delete_account(uuid)', 'execute'),
    '7a: authenticated must not have EXECUTE on delete_account';
  assert has_function_privilege('service_role', 'public.delete_account(uuid)', 'execute'),
    '7a: service_role must have EXECUTE on delete_account';
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('delete_account', 'phone_sign_in_lookup', 'register_expo_push_token')
             and p.prosecdef
             and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%') = 3,
    '7a: all three SECURITY DEFINER functions must pin search_path to empty';
end $$;

-- A tenant cannot mark themselves deleted (or undelete) through RLS.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
do $$
begin
  begin
    update public.profiles set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000e1';
    raise exception '7b: a tenant changed their own deleted_at';
  exception when raise_exception then
    if sqlerrm not like 'Not allowed to change deleted_at%' then raise; end if;
  end;
  begin
    perform public.delete_account('00000000-0000-0000-0000-0000000000e1');
    raise exception '7c: a signed-in tenant could call delete_account';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare r jsonb; r2 jsonb;
begin
  -- F: no records -> gone.
  r := public.delete_account('00000000-0000-0000-0000-0000000000f1');
  assert r->>'mode' = 'deleted', '7d: tenant without records must be deleted, got ' || r::text;

  -- E: rented -> anonymised, the landlord is named for the alert.
  r := public.delete_account('00000000-0000-0000-0000-0000000000e1');
  assert r->>'mode' = 'anonymised', '7e: tenant with a lease must be anonymised, got ' || r::text;
  assert (r->>'had_active_lease')::boolean, '7e: the active lease must be reported';
  assert r->>'landlord_id' = '00000000-0000-0000-0000-0000000000a1', '7e: landlord id for the alert';
  assert r->>'unit_label' = 'Check17 Unit', '7e: unit label for the alert';

  -- Twice is fine.
  r2 := public.delete_account('00000000-0000-0000-0000-0000000000e1');
  assert r2->>'mode' = 'anonymised', '7f: a second call must give the same result';

  begin
    perform public.delete_account('00000000-0000-0000-0000-0000000000a1');
    raise exception '7g: the landlord account was deleted';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$
begin
  assert not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000f1'),
    '7d: F''s profile must be gone';
  assert not exists (select 1 from public.expo_push_tokens where user_id = '00000000-0000-0000-0000-0000000000f1'),
    '7d: F''s token must be gone';
  assert not exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000f1'),
    '7d: F''s notifications must be gone';

  assert exists (select 1 from public.profiles
                  where id = '00000000-0000-0000-0000-0000000000e1'
                    and full_name = 'Former tenant (deleted)' and phone is null
                    and not email_notifications and deleted_at is not null),
    '7h: E''s profile must be anonymised';
  assert (select count(*) from public.payments where tenant_id = '00000000-0000-0000-0000-0000000000e1') = 1,
    '7h: E''s payment must be kept';
  assert exists (select 1 from public.leases where id = '00000000-0000-0000-0000-0000000000c7' and status = 'active'),
    '7h: E''s lease must be kept unchanged (the landlord ends it)';
  assert not exists (select 1 from public.expo_push_tokens where user_id = '00000000-0000-0000-0000-0000000000e1'),
    '7h: E''s push tokens must be gone';
  assert not exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000e1'),
    '7h: E''s notifications must be gone';
  assert exists (select 1 from public.messages where sender_id = '00000000-0000-0000-0000-0000000000e1'
                  and body = '(message deleted by the tenant)'),
    '7h: E''s own message text must be replaced';
  assert exists (select 1 from public.messages where sender_id = '00000000-0000-0000-0000-0000000000a1'
                  and recipient_id = '00000000-0000-0000-0000-0000000000e1' and body = 'check17 landlord words'),
    '7h: the landlord''s message must be kept';
  assert exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
    '7h: the landlord must be untouched';

  -- A deleted profile's number no longer signs in, even with a phone still set.
  update public.profiles set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000f2';
end $$;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare r record;
begin
  select * into r from public.phone_sign_in_lookup('0788000777', 'client-7');
  assert r.email is null and not r.limited, '7i: a deleted tenant''s number must not match';
end $$;

-- A deleted account cannot register a push token again.
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.register_expo_push_token('ExponentPushToken[check17EEEEEEEEEEEE]', 'ios');
    raise exception '7j: a deleted account registered a push token';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'all 17 checks passed' as result;
rollback;
