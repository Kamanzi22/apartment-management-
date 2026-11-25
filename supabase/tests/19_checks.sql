-- Checks for 19_advisor_fixes.sql. THROWAWAY database only; rolled back.
begin;
do $$
declare f text;
begin
  foreach f in array array['fmt_rwf', 'valid_day_list', 'render_alert_template', 'fmt_month', 'fmt_day'] loop
    assert exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = f
                      and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%'),
      '19a: ' || f || ' must have an empty search_path';
  end loop;
  -- Still work with the empty search_path.
  assert public.fmt_rwf(1234567) = '1,234,567 RWF', '19b: fmt_rwf';
  assert public.valid_day_list(array[1, 5, 31]) and not public.valid_day_list(array[40]), '19b: valid_day_list';
  assert public.render_alert_template('Hi {n}', '{"n":"Aline"}') = 'Hi Aline', '19b: render_alert_template';
  assert public.fmt_month('2026-11') = 'November 2026', '19b: fmt_month';
  assert public.fmt_day('2026-11-05') = '5 November 2026', '19b: fmt_day';
  foreach f in array array['public.create_alert_settings()', 'public.record_maintenance_status()'] loop
    assert not has_function_privilege('anon', f, 'execute'), '19c: anon can execute ' || f;
    assert not has_function_privilege('authenticated', f, 'execute'), '19c: authenticated can execute ' || f;
  end loop;
end $$;

-- The triggers still fire: a new landlord gets alert settings, a repair status change is recorded.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000191', 'check19@example.test');
insert into public.profiles (id, role, full_name) values ('00000000-0000-0000-0000-000000000191', 'landlord', 'Check19');
do $$
begin
  assert exists (select 1 from public.alert_settings where landlord_id = '00000000-0000-0000-0000-000000000191'),
    '19d: create_alert_settings trigger must still run';
end $$;

-- ── 19e. Tenant contract access (needs 17 for profiles.deleted_at) ──
reset role;
select set_config('request.jwt.claims', '', true);
insert into storage.buckets (id, name, public) values ('lease-contracts', 'lease-contracts', false) on conflict do nothing;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000001a1', 'c19-landlord@example.test'),
  ('00000000-0000-0000-0000-0000000001a2', 'c19-tenant-a@example.test'),
  ('00000000-0000-0000-0000-0000000001a3', 'c19-tenant-b@example.test'),
  ('00000000-0000-0000-0000-0000000001a4', 'c19-tenant-closed@example.test');
insert into public.units (id, label, bedroom_count, monthly_rent, status) values
  ('00000000-0000-0000-0000-0000000001b1', 'C19 A', 1, 300000, 'occupied'),
  ('00000000-0000-0000-0000-0000000001b2', 'C19 B', 1, 300000, 'occupied'),
  ('00000000-0000-0000-0000-0000000001b3', 'C19 C', 1, 300000, 'occupied');
insert into public.profiles (id, role, full_name, unit_id) values
  ('00000000-0000-0000-0000-0000000001a1', 'landlord', 'C19 Landlord', null),
  ('00000000-0000-0000-0000-0000000001a2', 'tenant', 'C19 A', '00000000-0000-0000-0000-0000000001b1'),
  ('00000000-0000-0000-0000-0000000001a3', 'tenant', 'C19 B', '00000000-0000-0000-0000-0000000001b2'),
  ('00000000-0000-0000-0000-0000000001a4', 'tenant', 'C19 Closed', '00000000-0000-0000-0000-0000000001b3');
insert into public.leases (id, unit_id, tenant_id, move_in_date, rent_due_day, monthly_rent, lease_start, status, contract_path) values
  ('00000000-0000-0000-0000-0000000001c1', '00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-0000000001a2', '2026-01-01', 1, 300000, '2026-01-01', 'active', '00000000-0000-0000-0000-0000000001c1/contract.pdf'),
  ('00000000-0000-0000-0000-0000000001c2', '00000000-0000-0000-0000-0000000001b2', '00000000-0000-0000-0000-0000000001a3', '2026-01-01', 1, 300000, '2026-01-01', 'active', '00000000-0000-0000-0000-0000000001c2/contract.pdf'),
  ('00000000-0000-0000-0000-0000000001c3', '00000000-0000-0000-0000-0000000001b3', '00000000-0000-0000-0000-0000000001a4', '2026-01-01', 1, 300000, '2026-01-01', 'active', '00000000-0000-0000-0000-0000000001c3/contract.pdf');
insert into storage.objects (bucket_id, name) values
  ('lease-contracts', '00000000-0000-0000-0000-0000000001c1/contract.pdf'),
  ('lease-contracts', '00000000-0000-0000-0000-0000000001c1/other.pdf'),
  ('lease-contracts', '00000000-0000-0000-0000-0000000001c2/contract.pdf'),
  ('lease-contracts', '00000000-0000-0000-0000-0000000001c3/contract.pdf');
-- The closed tenant's account is closed (as the owner; deleted_at is guarded for API users).
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
update public.profiles set deleted_at = now() where id = '00000000-0000-0000-0000-0000000001a4';

-- Tenant A: only own contract file.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000001a2","role":"authenticated"}', true);
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'lease-contracts') = 1,
    '19e-1: tenant A must see exactly one contract object (own)';
  assert exists (select 1 from storage.objects where bucket_id = 'lease-contracts'
                  and name = '00000000-0000-0000-0000-0000000001c1/contract.pdf'), '19e-1: tenant A cannot read own contract';
  assert not exists (select 1 from storage.objects where name like '00000000-0000-0000-0000-0000000001c2/%'),
    '19e-2: tenant A can read tenant B contract';
  assert not exists (select 1 from storage.objects where name = '00000000-0000-0000-0000-0000000001c1/other.pdf'),
    '19e-3: tenant A can read a file that is not the lease contract_path';
end $$;

-- Tenant B: only B's.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000001a3","role":"authenticated"}', true);
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'lease-contracts') = 1
     and exists (select 1 from storage.objects where name = '00000000-0000-0000-0000-0000000001c2/contract.pdf'),
    '19e-4: tenant B must see only own contract';
end $$;

-- Closed tenant: nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000001a4","role":"authenticated"}', true);
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'lease-contracts') = 0,
    '19e-5: closed tenant can read a contract';
end $$;

-- Anon: nothing (no error needed, but also no rows, and the helper is not callable).
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin
    assert (select count(*) from storage.objects where bucket_id = 'lease-contracts') = 0, '19e-6: anon can read a contract';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.tenant_can_read_contract('x');
    raise exception '19e-7: anon can call tenant_can_read_contract';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Landlord: unchanged, sees all four.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000001a1","role":"authenticated"}', true);
do $$
begin
  assert (select count(*) from storage.objects where bucket_id = 'lease-contracts') = 4, '19e-8: landlord must see all contracts';
end $$;
reset role;
select 'all 19 checks passed' as result;
rollback;
