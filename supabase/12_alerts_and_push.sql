-- ============================================================
-- MIGRATION 12: Daily scheduled alerts + web push subscriptions.
-- Apply after 11.
-- ============================================================

-- One row per alert ever sent; the key makes the daily job idempotent.
-- No policies: only the service role (cron job) can read or write it.
create table if not exists public.sent_alerts (
  key     text primary key,
  sent_at timestamptz not null default now()
);
alter table public.sent_alerts enable row level security;

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions: own" on public.push_subscriptions;
create policy "push_subscriptions: own" on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The earliest-created landlord receives landlord alerts.
create or replace function public.primary_landlord_id()
returns uuid language sql security definer stable set search_path = public as $$
  select id from public.profiles where role = 'landlord' order by created_at, id limit 1;
$$;

create or replace function public.fmt_rwf(n numeric)
returns text language sql immutable as $$
  select to_char(round(coalesce(n, 0)), 'FM999,999,999,990') || ' RWF';
$$;

-- Every alert that is due on p_today (Kigali date). The caller sends each one
-- whose key is not yet in sent_alerts.
--   Tenant:   rent due in 3 days; rent overdue 1 and 7 days after the due
--             date; lease ending in 30 days.
--   Landlord: receipt waiting more than 3 days; repair open more than 7 days.
create or replace function public.due_alerts(p_today date default public.app_today())
returns table (key text, user_id uuid, audience text, title text, body text, link text)
language sql stable security invoker set search_path = public as $$
  with landlord as (select public.primary_landlord_id() as id),
  soon as (
    select l.id as lease_id, l.tenant_id, r.*
    from public.leases l
    cross join lateral public.rent_ledger(l.id, p_today + 3) r
    where l.status = 'active' and r.due_date = p_today + 3
      and r.expected - r.confirmed_paid - r.pending_paid > 0
  ),
  late as (
    select l.id as lease_id, l.tenant_id, r.*, (p_today - r.due_date) as days_late
    from public.leases l
    cross join lateral public.rent_ledger(l.id, p_today) r
    where (p_today - r.due_date) in (1, 7)
      and r.balance - r.pending_paid > 0
  )
  select 'rent_due_soon:' || s.lease_id || ':' || s.period_month, s.tenant_id, 'tenant',
         'Rent due in 3 days',
         'Your rent of ' || public.fmt_rwf(s.expected - s.confirmed_paid - s.pending_paid)
           || ' for ' || to_char(to_date(s.period_month, 'YYYY-MM'), 'FMMonth YYYY')
           || ' is due on ' || to_char(s.due_date, 'FMMonth FMDD') || '.',
         '/'
  from soon s
  union all
  select 'rent_overdue_' || t.days_late || 'd:' || t.lease_id || ':' || t.period_month, t.tenant_id, 'tenant',
         'Rent overdue',
         'Your rent for ' || to_char(to_date(t.period_month, 'YYYY-MM'), 'FMMonth YYYY') || ' was due on '
           || to_char(t.due_date, 'FMMonth FMDD') || '. You still owe '
           || public.fmt_rwf(t.balance - t.pending_paid) || '.',
         '/'
  from late t
  union all
  select 'lease_ending:' || l.id || ':' || l.lease_end, l.tenant_id, 'tenant',
         'Lease ending in 30 days',
         'Your lease ends on ' || to_char(l.lease_end, 'FMMonth FMDD, YYYY')
           || '. Contact your landlord to renew or plan your move-out.',
         '/lease'
  from public.leases l
  where l.status = 'active' and l.lease_end = p_today + 30
  union all
  select 'receipt_waiting:' || p.id, ll.id, 'landlord',
         'Receipt waiting for review',
         coalesce(pr.full_name, 'A tenant') || ' (' || coalesce(u.label, 'unit') || ') submitted '
           || public.fmt_rwf(p.amount) || ' for ' || p.period_month || ' on '
           || to_char((p.submitted_at at time zone 'Africa/Kigali')::date, 'FMMonth FMDD')
           || '. It is still waiting for review.',
         '/landlord/rent'
  from public.payments p
  cross join landlord ll
  left join public.profiles pr on pr.id = p.tenant_id
  left join public.leases l on l.id = p.lease_id
  left join public.units u on u.id = l.unit_id
  where ll.id is not null and p.status = 'pending_review'
    and (p.submitted_at at time zone 'Africa/Kigali')::date < p_today - 3
  union all
  select 'repair_open:' || m.id, ll.id, 'landlord',
         'Repair open for more than 7 days',
         coalesce(u.label, 'A unit') || ': ' || left(m.description, 80) || ' (' || replace(m.status, '_', ' ')
           || ' since ' || to_char((m.created_at at time zone 'Africa/Kigali')::date, 'FMMonth FMDD') || ').',
         '/landlord/maintenance'
  from public.maintenance_requests m
  cross join landlord ll
  left join public.units u on u.id = m.unit_id
  where ll.id is not null and m.status <> 'resolved'
    and (m.created_at at time zone 'Africa/Kigali')::date < p_today - 7;
$$;

do $$
declare f text;
begin
  foreach f in array array['public.due_alerts(date)', 'public.primary_landlord_id()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
