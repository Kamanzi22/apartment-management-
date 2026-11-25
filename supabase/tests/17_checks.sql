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

-- ── 7. Closing an account (block login only) ─────────────────
-- Tenant E rents unit "Check17 Unit" (lease, payments, messages, a repair
-- with a photo, an alert, a push token) and closes the account. Nothing but
-- the token may disappear; the landlord's numbers must not move; the landlord
-- still reads everything, other tenants and anon read nothing; E's still-valid
-- token cannot write. Tenant G only checks the phone lookup.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);  -- lets the payment guard accept the test rows
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'check17-tenant-e@example.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'check17-tenant-g@example.test');
insert into public.units (id, label, bedroom_count, monthly_rent, status) values
  ('00000000-0000-0000-0000-0000000000b7', 'Check17 Unit', 1, 300000, 'occupied');
insert into public.profiles (id, role, full_name, phone, unit_id) values
  ('00000000-0000-0000-0000-0000000000e1', 'tenant', 'Check Tenant E', '0788 000 555', '00000000-0000-0000-0000-0000000000b7'),
  ('00000000-0000-0000-0000-0000000000f2', 'tenant', 'Check Tenant G', '0788 000 777', null);
insert into public.leases (id, unit_id, tenant_id, move_in_date, rent_due_day, monthly_rent, lease_start, status) values
  ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000b7',
   '00000000-0000-0000-0000-0000000000e1', '2026-01-01', 1, 300000, '2026-01-01', 'active');
insert into public.payments (lease_id, tenant_id, period_month, amount, status) values
  ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000e1', '2026-01', 300000, 'confirmed'),
  ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000e1', '2026-02', 150000, 'confirmed'),
  ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000e1', '2026-03', 300000, 'pending_review');
insert into public.messages (sender_id, recipient_id, body) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'check17 tenant words'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'check17 landlord words');
insert into public.maintenance_requests (unit_id, tenant_id, category, description, urgency, photo_urls) values
  ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000e1', 'plumbing',
   'check17 leak', 'low', array['00000000-0000-0000-0000-0000000000e1/leak.jpg']);
insert into public.notifications (user_id, type, title, body) values
  ('00000000-0000-0000-0000-0000000000e1', 'general', 'check17', 'x');
insert into public.expo_push_tokens (user_id, token, platform) values
  ('00000000-0000-0000-0000-0000000000e1', 'ExponentPushToken[check17EEEEEEEEEEEE]', 'ios');
select set_config('request.jwt.claims', '', true);

do $$
declare f text;
begin
  foreach f in array array['public.delete_account(uuid)', 'public.reactivate_account(uuid)'] loop
    assert not has_function_privilege('anon', f, 'execute'), '7a: anon must not have EXECUTE on ' || f;
    assert not has_function_privilege('authenticated', f, 'execute'), '7a: authenticated must not have EXECUTE on ' || f;
    assert has_function_privilege('service_role', f, 'execute'), '7a: service_role must have EXECUTE on ' || f;
  end loop;
  assert not has_function_privilege('anon', 'public.caller_is_closed()', 'execute'), '7a: anon must not call caller_is_closed';
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('delete_account', 'reactivate_account', 'caller_is_closed',
                               'phone_sign_in_lookup', 'register_expo_push_token')
             and p.prosecdef
             and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%') = 5,
    '7a: all five SECURITY DEFINER functions must pin search_path to empty';
end $$;

-- E cannot close or reopen themselves, nor touch deleted_at.
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
    raise exception '7b: a signed-in tenant could call delete_account';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.reactivate_account('00000000-0000-0000-0000-0000000000e1');
    raise exception '7b: a signed-in tenant could call reactivate_account';
  exception when insufficient_privilege then null;
  end;
end $$;

-- The landlord's numbers before closing, kept in session settings.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select set_config('check17.paid',
  (select coalesce(sum(amount), 0)::text from public.payments where tenant_id = '00000000-0000-0000-0000-0000000000e1'), true);
select set_config('check17.balance',
  public.tenant_balance('00000000-0000-0000-0000-0000000000e1', '2026-06-15')::text, true);
select set_config('check17.building',
  (select coalesce(sum(amount), 0)::text from public.payments where status = 'confirmed'), true);

-- Close E (what the delete-account Edge Function does after banning the login).
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare r jsonb;
begin
  r := public.delete_account('00000000-0000-0000-0000-0000000000e1');
  assert r->>'mode' = 'closed', '7c: mode must be closed, got ' || r::text;
  assert not (r->>'already_closed')::boolean, '7c: first call is not already_closed';
  assert (r->>'had_active_lease')::boolean, '7c: the active lease must be reported';
  assert r->>'landlord_id' = '00000000-0000-0000-0000-0000000000a1', '7c: landlord id for the alert';
  assert r->>'unit_label' = 'Check17 Unit', '7c: unit label for the alert';
  r := public.delete_account('00000000-0000-0000-0000-0000000000e1');
  assert (r->>'already_closed')::boolean, '7c: a second call must say already_closed';
  begin
    perform public.delete_account('00000000-0000-0000-0000-0000000000a1');
    raise exception '7c: the landlord account was closed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Nothing but the push token is gone.
reset role;
do $$
begin
  assert exists (select 1 from public.profiles
                  where id = '00000000-0000-0000-0000-0000000000e1'
                    and full_name = 'Check Tenant E' and phone = '0788 000 555'
                    and unit_id = '00000000-0000-0000-0000-0000000000b7' and deleted_at is not null),
    '7d: E''s profile must be unchanged except deleted_at';
  assert exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000e1'
                  and email = 'check17-tenant-e@example.test'), '7d: the login row and email must stay';
  assert not exists (select 1 from public.expo_push_tokens where user_id = '00000000-0000-0000-0000-0000000000e1'),
    '7d: E''s push tokens must be gone';
  assert (select count(*) from public.payments where tenant_id = '00000000-0000-0000-0000-0000000000e1') = 3,
    '7d: all of E''s payments must stay';
  assert exists (select 1 from public.leases where id = '00000000-0000-0000-0000-0000000000c7' and status = 'active'),
    '7d: E''s lease must stay unchanged (the landlord ends it)';
  assert (select count(*) from public.messages where body in ('check17 tenant words', 'check17 landlord words')) = 2,
    '7d: both messages must stay word for word';
  assert exists (select 1 from public.maintenance_requests where tenant_id = '00000000-0000-0000-0000-0000000000e1'
                  and photo_urls = array['00000000-0000-0000-0000-0000000000e1/leak.jpg']),
    '7d: the repair and its photo path must stay';
  assert exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000e1' and title = 'check17'),
    '7d: E''s notifications must stay';
end $$;

-- The landlord: same totals, still reads everything of E.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
begin
  assert (select coalesce(sum(amount), 0)::text from public.payments where tenant_id = '00000000-0000-0000-0000-0000000000e1')
         = current_setting('check17.paid'), '7e: payments total for E changed after closing';
  assert public.tenant_balance('00000000-0000-0000-0000-0000000000e1', '2026-06-15')::text
         = current_setting('check17.balance'), '7e: arrears for E changed after closing';
  assert (select coalesce(sum(amount), 0)::text from public.payments where status = 'confirmed')
         = current_setting('check17.building'), '7e: building income changed after closing';
  assert exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000e1'
                  and full_name = 'Check Tenant E' and deleted_at is not null), '7e: landlord reads the closed profile';
  assert exists (select 1 from public.leases where tenant_id = '00000000-0000-0000-0000-0000000000e1'), '7e: landlord reads the lease';
  assert (select count(*) from public.messages where sender_id = '00000000-0000-0000-0000-0000000000e1'
           or recipient_id = '00000000-0000-0000-0000-0000000000e1') = 2, '7e: landlord reads the messages';
  assert exists (select 1 from public.maintenance_requests where tenant_id = '00000000-0000-0000-0000-0000000000e1'), '7e: landlord reads the repair';
  assert exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000e1'), '7e: landlord reads E''s alerts';
end $$;

-- Another tenant (B) reads nothing of E.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
do $$
begin
  assert not exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000e1'), '7f: tenant B reads E''s profile';
  assert not exists (select 1 from public.payments where tenant_id = '00000000-0000-0000-0000-0000000000e1'), '7f: tenant B reads E''s payments';
  assert not exists (select 1 from public.leases where tenant_id = '00000000-0000-0000-0000-0000000000e1'), '7f: tenant B reads E''s lease';
  assert not exists (select 1 from public.maintenance_requests where tenant_id = '00000000-0000-0000-0000-0000000000e1'), '7f: tenant B reads E''s repair';
  assert not exists (select 1 from public.notifications where user_id = '00000000-0000-0000-0000-0000000000e1'), '7f: tenant B reads E''s alerts';
  assert not exists (select 1 from public.messages where body like 'check17 %'), '7f: tenant B reads E''s messages';
end $$;

-- Signed-out visitors read nothing of E (empty or permission denied both count).
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare t text; n int;
begin
  foreach t in array array['profiles', 'payments', 'leases', 'maintenance_requests', 'notifications', 'messages'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      assert n = 0, '7f: anon reads rows of ' || t;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

-- E's access token may still be valid for up to an hour: it cannot write anything.
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
do $$
begin
  begin
    insert into public.messages (sender_id, recipient_id, body)
    values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'check17 after closing');
    raise exception '7g: a closed account sent a message';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.notifications (user_id, type, title, body)
    values ('00000000-0000-0000-0000-0000000000a1', 'new_message', 'x', 'x');
    raise exception '7g: a closed account created an alert';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.payments (lease_id, tenant_id, period_month, amount)
    values ('00000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000e1', '2026-04', 1000);
    raise exception '7g: a closed account submitted a payment';
  exception when insufficient_privilege then null;
  end;
  update public.profiles set phone = '000000' where id = '00000000-0000-0000-0000-0000000000e1';
  begin
    perform public.register_expo_push_token('ExponentPushToken[check17EEEEEEEEEEEE]', 'ios');
    raise exception '7g: a closed account registered a push token';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$
begin
  assert exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000e1' and phone = '0788 000 555'),
    '7g: a closed account changed its own profile';
  update public.profiles set deleted_at = now() where id = '00000000-0000-0000-0000-0000000000f2';
end $$;

-- A closed account's number no longer signs in.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
declare r record;
begin
  select * into r from public.phone_sign_in_lookup('0788000777', 'client-7');
  assert r.email is null and not r.limited, '7h: a closed tenant''s number must not match';
  select * into r from public.phone_sign_in_lookup('0788000555', 'client-7');
  assert r.email is null and not r.limited, '7h: closed tenant E''s number must not match';

  -- Reactivate E (the landlord's reactivate-tenant / server action also lifts the ban).
  assert public.reactivate_account('00000000-0000-0000-0000-0000000000e1'), '7i: reactivate must report it was closed';
  assert not public.reactivate_account('00000000-0000-0000-0000-0000000000e1'), '7i: a second reactivate reports not closed';
  begin
    perform public.reactivate_account('00000000-0000-0000-0000-0000000000a1');
    raise exception '7i: reactivate_account accepted the landlord';
  exception when insufficient_privilege then null;
  end;
  select * into r from public.phone_sign_in_lookup('0788000555', 'client-8');
  assert r.email = 'check17-tenant-e@example.test', '7i: E''s number signs in again after reactivation';
end $$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
do $$
begin
  insert into public.messages (sender_id, recipient_id, body)
  values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'check17 back again');
  perform public.register_expo_push_token('ExponentPushToken[check17EEEEEEEEEEEE]', 'ios');
end $$;
reset role;
do $$
begin
  assert exists (select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000e1' and deleted_at is null),
    '7i: deleted_at must be cleared';
  assert exists (select 1 from public.expo_push_tokens where user_id = '00000000-0000-0000-0000-0000000000e1'),
    '7i: a reactivated account can register a token again';
end $$;

-- ── 8. payments.method and tenant_rent_policy() ──────────────
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
begin
  update public.payments set method = 'momo'
   where tenant_id = '00000000-0000-0000-0000-0000000000e1' and period_month = '2026-01';
  assert exists (select 1 from public.payments where method = 'momo'), '8a: momo must be accepted';
  begin
    update public.payments set method = 'paypal' where tenant_id = '00000000-0000-0000-0000-0000000000e1';
    raise exception '8b: an unknown payment method was accepted';
  exception when check_violation then null;
  end;
  assert exists (select 1 from public.payments where method is null), '8c: method stays optional';
end $$;
select set_config('request.jwt.claims', '', true);

do $$
begin
  assert not has_function_privilege('anon', 'public.tenant_rent_policy()', 'execute'), '8d: anon must not call tenant_rent_policy';
  assert has_function_privilege('authenticated', 'public.tenant_rent_policy()', 'execute'), '8d: signed-in users call tenant_rent_policy';
end $$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
do $$
declare r record; n int;
begin
  select count(*) into n from public.tenant_rent_policy();
  assert n = 1, '8e: exactly one row';
  select * into r from public.tenant_rent_policy();
  assert r.notice_period_days between 1 and 365, '8e: a notice period in days';
  -- The landlord-only function from 18 (if present) still gives a tenant nothing.
  if to_regproc('public.alert_settings_current') is not null then
    execute 'select count(*) from public.alert_settings_current()' into n;
    assert n = 0, '8f: a tenant must not read alert settings / templates';
  end if;
end $$;

reset role;
select 'all 17 checks passed' as result;
rollback;
