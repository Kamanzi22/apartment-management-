-- ============================================================
-- MIGRATION 09: Rent history (rent_schedule) + one rent ledger
-- for both apps. Apply after 08.
-- ============================================================

-- Tenants read the landlord's profile (name on the Messages page, and the
-- landlord id for alerts). This policy already exists in production; it is
-- repeated here so a fresh database built from these files matches.
drop policy if exists "profiles: tenant reads landlord" on public.profiles;
create policy "profiles: tenant reads landlord" on public.profiles for select
  using (role = 'landlord');

-- "Today" for rent purposes is always the Kigali calendar date, whatever
-- time zone the server or the database session runs in.
create or replace function public.app_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Africa/Kigali')::date;
$$;

-- ── rent_schedule ────────────────────────────────────────────
create table if not exists public.rent_schedule (
  id              uuid primary key default gen_random_uuid(),
  lease_id        uuid not null references public.leases(id) on delete cascade,
  effective_month text not null check (effective_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  monthly_rent    numeric(10,2) not null check (monthly_rent >= 0),
  created_at      timestamptz not null default now(),
  unique (lease_id, effective_month)
);

alter table public.rent_schedule enable row level security;

drop policy if exists "rent_schedule: landlord full access" on public.rent_schedule;
create policy "rent_schedule: landlord full access" on public.rent_schedule for all
  using (public.is_landlord()) with check (public.is_landlord());

drop policy if exists "rent_schedule: tenant reads own" on public.rent_schedule;
create policy "rent_schedule: tenant reads own" on public.rent_schedule for select
  using (exists (select 1 from public.leases l
                 where l.id = rent_schedule.lease_id and l.tenant_id = auth.uid()));

-- Backfill: one row per existing lease, from its move-in month, at the rent
-- stored on the lease today. If a raise was already typed over the old rent,
-- correct that lease's rows by hand (see README).
insert into public.rent_schedule (lease_id, effective_month, monthly_rent)
select id, to_char(move_in_date, 'YYYY-MM'), monthly_rent from public.leases
on conflict (lease_id, effective_month) do nothing;

-- Every new lease, and every change to leases.monthly_rent, adds a schedule
-- row. The month a change takes effect comes from the transaction setting
-- app.rent_effective_month (set by set_unit_rent below), otherwise the
-- current Kigali month.
create or replace function public.record_rent_change()
returns trigger language plpgsql set search_path = public as $$
declare
  v_month text;
  v_first text := to_char(new.move_in_date, 'YYYY-MM');
begin
  if tg_op = 'INSERT' then
    v_month := v_first;
  else
    if new.monthly_rent is not distinct from old.monthly_rent then return new; end if;
    v_month := coalesce(nullif(current_setting('app.rent_effective_month', true), ''),
                        to_char(public.app_today(), 'YYYY-MM'));
    if v_month < v_first then v_month := v_first; end if;
  end if;
  insert into public.rent_schedule (lease_id, effective_month, monthly_rent)
  values (new.id, v_month, new.monthly_rent)
  on conflict (lease_id, effective_month)
    do update set monthly_rent = excluded.monthly_rent, created_at = now();
  return new;
end;
$$;

drop trigger if exists leases_rent_schedule on public.leases;
create trigger leases_rent_schedule after insert or update of monthly_rent on public.leases
  for each row execute function public.record_rent_change();

-- Landlord action "Edit rent": new rent for the unit and its active lease,
-- effective from a given month. Runs with the caller's rights (RLS applies).
create or replace function public.set_unit_rent(p_unit uuid, p_rent numeric, p_effective_month text)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.is_landlord() and not public.is_service_role() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_rent is null or p_rent < 0 then raise exception 'Rent must be zero or more'; end if;
  if p_effective_month is null or p_effective_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Effective month must look like YYYY-MM';
  end if;

  perform set_config('app.rent_effective_month', p_effective_month, true);
  update public.units set monthly_rent = p_rent where id = p_unit;
  update public.leases set monthly_rent = p_rent where unit_id = p_unit and status = 'active';
  -- Also record it when the amount did not change but the month did.
  insert into public.rent_schedule (lease_id, effective_month, monthly_rent)
  select l.id, greatest(p_effective_month, to_char(l.move_in_date, 'YYYY-MM')), p_rent
  from public.leases l where l.unit_id = p_unit and l.status = 'active'
  on conflict (lease_id, effective_month)
    do update set monthly_rent = excluded.monthly_rent, created_at = now();
  perform set_config('app.rent_effective_month', '', true);
end;
$$;

-- ── The rent ledger ──────────────────────────────────────────
-- One row per lease month in [p_from, p_to] (clipped to the lease):
--   due_date  = min(rent_due_day, last day of the month, lease_end)
--   expected  = rent_schedule rent in force that month (a month is billed in
--               full if the lease covered any day of it)
--   confirmed_paid / pending_paid = sums of confirmed / pending payments;
--               rejected payments count as unpaid
--   balance   = expected - confirmed_paid once the due date is reached, else 0
--   status    = paid | pending | not_due | partial | overdue
-- SECURITY INVOKER: RLS decides which leases and payments the caller sees.
create or replace function public.rent_ledger_range(p_lease uuid, p_from date, p_to date, p_today date)
returns table (
  period_month   text,
  due_date       date,
  expected       numeric,
  confirmed_paid numeric,
  pending_paid   numeric,
  balance        numeric,
  status         text
)
language sql stable security invoker set search_path = public as $$
  with l as (
    select id, move_in_date, lease_end, rent_due_day, monthly_rent
    from public.leases where id = p_lease
  ),
  m as (
    select l.id, l.rent_due_day, l.lease_end, l.monthly_rent, gs::date as ms
    from l cross join generate_series(
      greatest(date_trunc('month', l.move_in_date::timestamp), date_trunc('month', p_from::timestamp)),
      least(date_trunc('month', coalesce(l.lease_end, p_to)::timestamp), date_trunc('month', p_to::timestamp)),
      interval '1 month') gs
  ),
  c as (
    select
      to_char(m.ms, 'YYYY-MM') as pm,
      least(
        (m.ms + (least(m.rent_due_day,
                       extract(day from (m.ms + interval '1 month' - interval '1 day'))::int) - 1))::date,
        coalesce(m.lease_end, 'infinity'::date)) as dd,
      coalesce(
        (select rs.monthly_rent from public.rent_schedule rs
          where rs.lease_id = m.id and rs.effective_month <= to_char(m.ms, 'YYYY-MM')
          order by rs.effective_month desc limit 1),
        (select rs.monthly_rent from public.rent_schedule rs
          where rs.lease_id = m.id order by rs.effective_month limit 1),
        m.monthly_rent) as ex,
      coalesce((select sum(p.amount) from public.payments p
                 where p.lease_id = m.id and p.period_month = to_char(m.ms, 'YYYY-MM')
                   and p.status = 'confirmed'), 0) as cp,
      coalesce((select sum(p.amount) from public.payments p
                 where p.lease_id = m.id and p.period_month = to_char(m.ms, 'YYYY-MM')
                   and p.status = 'pending_review'), 0) as pp
    from m
  )
  select pm, dd, ex, cp, pp,
    case when p_today >= dd then greatest(ex - cp, 0) else 0::numeric end,
    case
      when cp >= ex then 'paid'
      when pp > 0 and cp + pp >= ex then 'pending'
      when p_today < dd then 'not_due'
      when cp + pp > 0 then 'partial'
      else 'overdue'
    end
  from c
  order by pm;
$$;

-- From move-in to min(lease_end month, today's month).
create or replace function public.rent_ledger(p_lease uuid, p_today date default public.app_today())
returns table (
  period_month text, due_date date, expected numeric, confirmed_paid numeric,
  pending_paid numeric, balance numeric, status text
)
language sql stable security invoker set search_path = public as $$
  select * from public.rent_ledger_range(p_lease, '0001-01-01'::date, p_today, p_today);
$$;

-- The next p_months months after today's month (for paying ahead).
create or replace function public.rent_upcoming(p_lease uuid, p_months int default 6,
                                                p_today date default public.app_today())
returns table (
  period_month text, due_date date, expected numeric, confirmed_paid numeric,
  pending_paid numeric, balance numeric, status text
)
language sql stable security invoker set search_path = public as $$
  select * from public.rent_ledger_range(
    p_lease,
    (date_trunc('month', p_today::timestamp) + interval '1 month')::date,
    (date_trunc('month', p_today::timestamp) + make_interval(months => greatest(p_months, 0)))::date,
    p_today)
  where p_months > 0;
$$;

-- Several leases in one call (landlord pages).
create or replace function public.rent_ledger_many(p_leases uuid[], p_today date default public.app_today())
returns table (
  lease_id uuid, period_month text, due_date date, expected numeric, confirmed_paid numeric,
  pending_paid numeric, balance numeric, status text
)
language sql stable security invoker set search_path = public as $$
  select x.id, r.* from unnest(p_leases) as x(id)
  cross join lateral public.rent_ledger(x.id, p_today) r;
$$;

-- Everything a tenant owes, across ALL of their leases (old units included).
create or replace function public.tenant_balance(p_tenant uuid, p_today date default public.app_today())
returns numeric language sql stable security invoker set search_path = public as $$
  select coalesce(sum(r.balance), 0)
  from public.leases l cross join lateral public.rent_ledger(l.id, p_today) r
  where l.tenant_id = p_tenant;
$$;

-- PUBLIC holds EXECUTE on new functions by default, so revoke from it too.
do $$
declare f text;
begin
  foreach f in array array[
    'public.rent_ledger_range(uuid, date, date, date)',
    'public.rent_ledger(uuid, date)',
    'public.rent_upcoming(uuid, int, date)',
    'public.rent_ledger_many(uuid[], date)',
    'public.tenant_balance(uuid, date)',
    'public.set_unit_rent(uuid, numeric, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
