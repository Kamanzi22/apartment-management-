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
select 'all 19 checks passed' as result;
rollback;
