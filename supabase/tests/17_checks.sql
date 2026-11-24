-- Checks for 17_mobile_push_and_phone_login.sql (DRAFT).
--
-- NEVER run this against production. Run it in a THROWAWAY database that has
-- the migrations applied: a Supabase branch / local stack, or a plain
-- Postgres 16 with tests/supabase_stubs.sql + 01..17 applied.
-- Everything happens inside one transaction that is rolled back, so it leaves
-- nothing behind. Any failed check stops the script with an error that names it.
--
--   psql "$THROWAWAY_URL" -v ON_ERROR_STOP=1 -f supabase/tests/17_checks.sql
--
-- Not run yet: written without a database (24 Nov 2026).

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
select 'all 17 checks passed' as result;
rollback;
