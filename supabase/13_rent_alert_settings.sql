-- ============================================================
-- MIGRATION 13: Rent alerts the landlord controls + unpaid-rent limit.
-- Apply after 12. Replaces the fixed timings of due_alerts() (12).
-- ============================================================

-- ── Faster rent ledger ───────────────────────────────────────
-- Same signature and results as in 09, but payments and the rent schedule
-- are aggregated once per lease instead of once per month (about 4x faster;
-- the hourly job calls it for every lease).
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
    select l.rent_due_day, l.lease_end, l.monthly_rent, gs::date as ms, to_char(gs, 'YYYY-MM') as pm
    from l cross join generate_series(
      greatest(date_trunc('month', l.move_in_date::timestamp), date_trunc('month', p_from::timestamp)),
      least(date_trunc('month', coalesce(l.lease_end, p_to)::timestamp), date_trunc('month', p_to::timestamp)),
      interval '1 month') gs
  ),
  pay as (
    select p.period_month,
      sum(p.amount) filter (where p.status = 'confirmed') as cp,
      sum(p.amount) filter (where p.status = 'pending_review') as pp
    from public.payments p where p.lease_id = p_lease
    group by p.period_month
  ),
  sch as (
    select rs.effective_month, rs.monthly_rent,
      lead(rs.effective_month) over (order by rs.effective_month) as next_month,
      row_number() over (order by rs.effective_month) as rn
    from public.rent_schedule rs where rs.lease_id = p_lease
  ),
  c as (
    select m.pm,
      least(
        (m.ms + (least(m.rent_due_day,
                       extract(day from (m.ms + interval '1 month' - interval '1 day'))::int) - 1))::date,
        coalesce(m.lease_end, 'infinity'::date)) as dd,
      coalesce(
        (select s.monthly_rent from sch s where s.effective_month <= m.pm and (s.next_month is null or s.next_month > m.pm)),
        (select s.monthly_rent from sch s where s.rn = 1),
        m.monthly_rent) as ex,
      coalesce(pay.cp, 0) as cp,
      coalesce(pay.pp, 0) as pp
    from m left join pay on pay.period_month = m.pm
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

-- ── Settings, one row per landlord ───────────────────────────
create or replace function public.valid_day_list(d int[])
returns boolean language sql immutable as $$
  select d is null or (cardinality(d) <= 15 and not exists (select 1 from unnest(d) x where x is null or x < 0 or x > 31));
$$;

create table if not exists public.alert_settings (
  landlord_id                uuid primary key references public.profiles(id) on delete cascade,
  enabled                    boolean not null default true,
  before_due_days            int[]   not null default '{5,1}',
  on_due_day                 boolean not null default true,
  after_due_days             int[]   not null default '{1,5,10}',
  warning_after_days         int     not null default 5,
  final_warning_after_days   int     not null default 15,
  notify_landlord_after_days int     not null default 3,
  send_hour                  int     not null default 9,
  channels                   text[]  not null default '{in_app,email}',
  tpl_before        text not null default 'Hello {tenant_name}, a friendly reminder that your rent of {amount} for {month} ({unit}) is due on {due_date}. Thank you. {landlord_name}',
  tpl_due_today     text not null default 'Hello {tenant_name}, your rent of {amount} for {month} ({unit}) is due today, {due_date}. Thank you. {landlord_name}',
  tpl_overdue       text not null default 'Hello {tenant_name}, your rent for {month} ({unit}) was due on {due_date} and is now {days_late} day(s) late. {amount} is still to pay. Please pay when you can, or reply if you would like to talk. {landlord_name}',
  tpl_warning       text not null default 'Hello {tenant_name}, your rent for {month} ({unit}) is {days_late} days late and {amount} is still owed. Please pay as soon as possible. {landlord_name}',
  tpl_final_warning text not null default 'Hello {tenant_name}, this is a final warning: your rent for {month} ({unit}) is {days_late} days late and {amount} is still owed. Please pay now or contact me today. {landlord_name}',
  tpl_over_limit    text not null default 'Hello {tenant_name}, your unpaid rent is now past the agreed limit. You owe {amount} in total. Please pay by {due_date}, or contact me to agree a payment plan. {landlord_name}',
  lease_ending_days          int not null default 30,
  receipt_waiting_days       int not null default 3,
  repair_open_days           int not null default 7,
  grace_days                 int not null default 5,
  max_unpaid_days            int not null default 30,
  notice_period_days         int not null default 30,
  updated_at                 timestamptz not null default now(),
  constraint alert_settings_days check (valid_day_list(before_due_days) and valid_day_list(after_due_days)),
  constraint alert_settings_hour check (send_hour between 0 and 23),
  constraint alert_settings_channels check (channels <@ array['in_app', 'email', 'sms']),
  constraint alert_settings_numbers check (
    warning_after_days between 0 and 365 and final_warning_after_days between 0 and 365
    and notify_landlord_after_days between 0 and 365 and lease_ending_days between 1 and 365
    and receipt_waiting_days between 1 and 90 and repair_open_days between 1 and 365
    and grace_days between 0 and 60 and max_unpaid_days between 1 and 730
    and notice_period_days between 1 and 365)
);
alter table public.alert_settings enable row level security;
drop policy if exists "alert_settings: landlord full access" on public.alert_settings;
create policy "alert_settings: landlord full access" on public.alert_settings for all
  using (public.is_landlord()) with check (public.is_landlord());

insert into public.alert_settings (landlord_id)
select id from public.profiles where role = 'landlord'
on conflict (landlord_id) do nothing;

-- New landlords get a settings row automatically.
create or replace function public.create_alert_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'landlord' then
    insert into public.alert_settings (landlord_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_alert_settings on public.profiles;
create trigger profiles_alert_settings after insert or update of role on public.profiles
  for each row execute function public.create_alert_settings();

-- The settings in force: the earliest landlord's row (the one who gets alerts).
-- SECURITY DEFINER so a tenant's rent status can use the grace period and limit.
create or replace function public.alert_settings_current()
returns setof public.alert_settings language sql security definer stable set search_path = public as $$
  select * from public.alert_settings where landlord_id = public.primary_landlord_id();
$$;

-- ── Per-tenant overrides ─────────────────────────────────────
-- Null days mean "use the landlord defaults"; enabled = false pauses alerts.
create table if not exists public.lease_alert_overrides (
  lease_id        uuid primary key references public.leases(id) on delete cascade,
  enabled         boolean not null default true,
  before_due_days int[],
  after_due_days  int[],
  updated_at      timestamptz not null default now(),
  constraint lease_alert_overrides_days check (valid_day_list(before_due_days) and valid_day_list(after_due_days))
);
alter table public.lease_alert_overrides enable row level security;
drop policy if exists "lease_alert_overrides: landlord full access" on public.lease_alert_overrides;
create policy "lease_alert_overrides: landlord full access" on public.lease_alert_overrides for all
  using (public.is_landlord()) with check (public.is_landlord());

-- ── sent_alerts: the send log (one row per alert per channel) ─
alter table public.sent_alerts add column if not exists level        text;
alter table public.sent_alerts add column if not exists days_offset  int;
alter table public.sent_alerts add column if not exists channel      text;
alter table public.sent_alerts add column if not exists lease_id     uuid references public.leases(id) on delete set null;
alter table public.sent_alerts add column if not exists period_month text;
alter table public.sent_alerts add column if not exists user_id      uuid references public.profiles(id) on delete set null;
create index if not exists sent_alerts_sent_at_idx on public.sent_alerts (sent_at desc);
drop policy if exists "sent_alerts: landlord reads" on public.sent_alerts;
create policy "sent_alerts: landlord reads" on public.sent_alerts for select using (public.is_landlord());

-- ── Unpaid-rent limit ────────────────────────────────────────
create table if not exists public.rent_limit_actions (
  id         uuid primary key default gen_random_uuid(),
  lease_id   uuid not null references public.leases(id) on delete cascade,
  action     text not null check (action in ('payment_plan', 'more_time', 'notice_to_vacate', 'resume')),
  details    jsonb not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists rent_limit_actions_lease_idx on public.rent_limit_actions (lease_id, created_at desc);
alter table public.rent_limit_actions enable row level security;
drop policy if exists "rent_limit_actions: landlord full access" on public.rent_limit_actions;
create policy "rent_limit_actions: landlord full access" on public.rent_limit_actions for all
  using (public.is_landlord()) with check (public.is_landlord());

create table if not exists public.vacate_notices (
  id             uuid primary key default gen_random_uuid(),
  lease_id       uuid not null references public.leases(id) on delete cascade,
  tenant_id      uuid not null references public.profiles(id) on delete cascade,
  issued_by      uuid references public.profiles(id) on delete set null,
  issued_at      timestamptz not null default now(),
  move_out_date  date not null,
  reason         text,
  status         text not null default 'issued' check (status in ('issued', 'withdrawn'))
);
alter table public.vacate_notices enable row level security;
drop policy if exists "vacate_notices: landlord full access" on public.vacate_notices;
create policy "vacate_notices: landlord full access" on public.vacate_notices for all
  using (public.is_landlord()) with check (public.is_landlord());
drop policy if exists "vacate_notices: tenant reads own" on public.vacate_notices;
create policy "vacate_notices: tenant reads own" on public.vacate_notices for select
  using (tenant_id = auth.uid());

-- Payment plan on a lease as of p_today: the latest 'payment_plan' action
-- (details: amount_per_month, end_date) not followed by 'resume'.
-- Installments fall due monthly from one month after the plan starts; only
-- payments for months before the plan's start month count towards it.
create or replace function public.rent_plan_state(p_lease uuid, p_today date)
returns table (start_date date, end_date date, amount numeric, active boolean, kept boolean,
               missed_on date, required numeric, paid numeric)
language sql stable security definer set search_path = public as $$
  with plan as (
    select (a.created_at at time zone 'Africa/Kigali')::date as s,
           (a.details->>'end_date')::date as e,
           (a.details->>'amount_per_month')::numeric as amt,
           a.created_at
    from public.rent_limit_actions a
    where a.lease_id = p_lease and a.action = 'payment_plan'
      and (a.created_at at time zone 'Africa/Kigali')::date <= p_today
    order by a.created_at desc limit 1
  ),
  live as (
    select p.* from plan p
    where p_today <= p.e
      and not exists (select 1 from public.rent_limit_actions r
                      where r.lease_id = p_lease and r.action = 'resume'
                        and r.created_at > p.created_at
                        and (r.created_at at time zone 'Africa/Kigali')::date <= p_today)
  ),
  inst as (
    -- start + k months each time (31 Jan -> 29 Feb -> 31 Mar, no drift)
    select l.*, (l.s + make_interval(months => k))::date as due
    from live l cross join generate_series(1, 240) k
    where (l.s + make_interval(months => k))::date <= l.e
  ),
  calc as (
    select l.s, l.e, l.amt,
      (select count(*) from inst i where i.due < p_today) * l.amt as req,
      coalesce((select sum(pay.amount) from public.payments pay
                where pay.lease_id = p_lease and pay.status in ('confirmed', 'pending_review')
                  and pay.period_month < to_char(l.s, 'YYYY-MM')
                  and (pay.submitted_at at time zone 'Africa/Kigali')::date >= l.s), 0) as pd
    from live l
  )
  select c.s, c.e, c.amt, true, c.pd >= c.req,
         case when c.pd < c.req then (select max(i.due) from inst i where i.due < p_today) end,
         c.req, c.pd
  from calc c;
$$;

-- Each lease's position against the limit. Landlord sees every lease, a
-- tenant only their own. state: ok | due | late | over_limit | plan | more_time
--   due        oldest unpaid month is 0..grace_days past its due date
--   late       later than that, up to max_unpaid_days
--   over_limit more than max_unpaid_days
--   plan       would be over the limit, but a payment plan is being kept
--   more_time  would be over the limit, but the landlord gave time until a date
create or replace function public.rent_limit_status(p_today date default public.app_today())
returns table (
  lease_id uuid, tenant_id uuid, unit_id uuid, lease_active boolean,
  total_owed numeric, oldest_month text, oldest_due date, days_late int, state text,
  plan_amount numeric, plan_end date, plan_kept boolean, more_time_until date,
  vacate_move_out date, grace_days int, max_unpaid_days int
)
language sql stable security definer set search_path = public as $$
  with s as (select * from public.alert_settings_current()),
  l as (
    -- caller_is_admin(), not is_service_role(): inside SECURITY DEFINER the
    -- current user is the owner, so is_service_role() would always be true.
    select * from public.leases x
    where public.caller_is_admin() or x.tenant_id = auth.uid()
  ),
  owed as (
    select l.id, l.tenant_id, l.unit_id, l.status,
      r.period_month, r.due_date, greatest(r.balance - r.pending_paid, 0) as unpaid
    from l cross join lateral public.rent_ledger(l.id, p_today) r
  ),
  agg as (
    select o.id, o.tenant_id, o.unit_id, o.status,
      sum(o.unpaid) as total,
      min(o.period_month) filter (where o.unpaid > 0) as oldest_month,
      min(o.due_date) filter (where o.unpaid > 0) as oldest_due
    from owed o group by o.id, o.tenant_id, o.unit_id, o.status
  ),
  more as (
    select a.lease_id, max((a.details->>'until')::date) as until
    from public.rent_limit_actions a
    where a.action = 'more_time' and (a.created_at at time zone 'Africa/Kigali')::date <= p_today
      and not exists (select 1 from public.rent_limit_actions r
                      where r.lease_id = a.lease_id and r.action = 'resume' and r.created_at > a.created_at
                        and (r.created_at at time zone 'Africa/Kigali')::date <= p_today)
    group by a.lease_id
  )
  select g.id, g.tenant_id, g.unit_id, g.status = 'active', coalesce(g.total, 0), g.oldest_month, g.oldest_due,
    case when g.oldest_due is null then 0 else (p_today - g.oldest_due) end,
    case
      when g.oldest_due is null or p_today < g.oldest_due then 'ok'
      when p_today - g.oldest_due <= coalesce(s.grace_days, 5) then 'due'
      when p_today - g.oldest_due <= coalesce(s.max_unpaid_days, 30) then 'late'
      when m.until is not null and m.until >= p_today then 'more_time'
      when p.active and p.kept then 'plan'
      else 'over_limit'
    end,
    p.amount, p.end_date, p.kept, case when m.until >= p_today then m.until end,
    (select max(v.move_out_date) from public.vacate_notices v where v.lease_id = g.id and v.status = 'issued'
       and (v.issued_at at time zone 'Africa/Kigali')::date <= p_today),
    coalesce(s.grace_days, 5), coalesce(s.max_unpaid_days, 30)
  from agg g
  left join s on true
  left join more m on m.lease_id = g.id
  left join lateral public.rent_plan_state(g.id, p_today) p on true
  where g.status = 'active' or coalesce(g.total, 0) > 0;
$$;

create or replace function public.render_alert_template(p_tpl text, p_vars jsonb)
returns text language plpgsql immutable as $$
declare k text; v text; out text := coalesce(p_tpl, '');
begin
  for k, v in select key, value from jsonb_each_text(p_vars) loop
    out := replace(out, '{' || k || '}', coalesce(v, ''));
  end loop;
  return out;
end;
$$;

create or replace function public.fmt_month(m text)
returns text language sql immutable as $$ select to_char(to_date(m, 'YYYY-MM'), 'FMMonth YYYY'); $$;
create or replace function public.fmt_day(d date)
returns text language sql immutable as $$ select to_char(d, 'FMDD FMMonth YYYY'); $$;

-- ── The hourly job ───────────────────────────────────────────
-- Returns every alert to send at p_now. Nothing unless the Kigali hour equals
-- send_hour. Each row is sent once per channel; the caller records
-- key || ':' || channel in sent_alerts first, so a rerun sends nothing new.
drop function if exists public.due_alerts(date);
create or replace function public.due_alerts(p_now timestamptz default now())
returns table (
  key text, user_id uuid, audience text, level text, notif_type text, days_offset int,
  lease_id uuid, period_month text, title text, body text, link text, channels text[]
)
language sql stable security invoker set search_path = public as $$
  with s as (select * from public.alert_settings_current()),
  clock as (
    select (p_now at time zone 'Africa/Kigali')::date as today,
           extract(hour from (p_now at time zone 'Africa/Kigali'))::int as hr
  ),
  run as (
    select s.*, c.today,
      greatest(s.warning_after_days, s.grace_days) as warn_at,
      greatest(s.final_warning_after_days, s.grace_days, s.warning_after_days) as final_at,
      (select full_name from public.profiles where id = s.landlord_id) as landlord_name
    from s cross join clock c where c.hr = s.send_hour
  ),
  status as (select st.* from run cross join lateral public.rent_limit_status((select today from run)) st),
  lease_info as (
    select l.id, l.tenant_id, l.status, u.label as unit_label, p.full_name as tenant_name,
      coalesce(o.enabled, true) as on_,
      coalesce(o.before_due_days, r.before_due_days) as before_days,
      coalesce(o.after_due_days, r.after_due_days) as after_days,
      st.state, st.total_owed, st.oldest_month, st.days_late,
      coalesce((select pl.active and pl.kept from public.rent_plan_state(l.id, r.today) pl), false) as on_plan
    from run r
    join public.leases l on true
    join status st on st.lease_id = l.id
    left join public.units u on u.id = l.unit_id
    left join public.profiles p on p.id = l.tenant_id
    left join public.lease_alert_overrides o on o.lease_id = l.id
  ),
  months as (
    select li.*, m.period_month as pm, m.due_date, m.expected - m.confirmed_paid as remaining,
      (r.today - m.due_date) as off, r.*
    from run r
    join lease_info li on r.enabled and li.on_
    cross join lateral public.rent_ledger_range(li.id, '0001-01-01'::date, r.today + 31, r.today) m
    where m.expected - m.confirmed_paid > 0 and m.pending_paid = 0   -- skip paid months and receipts in review
  ),
  rent as (
    select mo.*,
      case when mo.off < 0 then 'before' when mo.off = 0 then 'due_today'
           when mo.off >= mo.final_at then 'final_warning'
           when mo.off >= mo.warn_at then 'warning' else 'overdue' end as lvl
    from months mo
    where (mo.off < 0 and mo.status = 'active' and -mo.off = any(mo.before_days))
       or (mo.off = 0 and mo.status = 'active' and mo.on_due_day)
       or (mo.off > 0 and not mo.on_plan
           and (mo.off = any(mo.after_days) or mo.off = mo.warn_at or mo.off = mo.final_at))
  )
  -- Rent reminders and warnings to the tenant.
  select 'rent:' || x.id || ':' || x.pm || ':' || x.off, x.tenant_id, 'tenant', x.lvl,
    case x.lvl when 'warning' then 'rent_warning' when 'final_warning' then 'rent_final_warning' else 'rent_reminder' end,
    x.off, x.id, x.pm,
    case x.lvl when 'before' then 'Rent reminder' when 'due_today' then 'Rent due today'
               when 'overdue' then 'Rent overdue' when 'warning' then 'Rent warning'
               else 'Final warning: rent overdue' end,
    public.render_alert_template(
      case x.lvl when 'before' then x.tpl_before when 'due_today' then x.tpl_due_today
                 when 'overdue' then x.tpl_overdue when 'warning' then x.tpl_warning else x.tpl_final_warning end,
      jsonb_build_object('tenant_name', x.tenant_name, 'unit', x.unit_label, 'amount', public.fmt_rwf(x.remaining),
        'month', public.fmt_month(x.pm), 'due_date', public.fmt_day(x.due_date),
        'days_late', greatest(x.off, 0), 'landlord_name', x.landlord_name)),
    '/?lease=' || x.id || '&month=' || x.pm || '#pay',
    x.channels
  from rent x

  union all
  -- First time over the unpaid limit: final notice to the tenant ...
  select 'over_limit:' || li.id || ':' || li.oldest_month, li.tenant_id, 'tenant', 'final_notice', 'rent_final_warning',
    li.days_late, li.id, li.oldest_month, 'Final notice: unpaid rent',
    public.render_alert_template(r.tpl_over_limit, jsonb_build_object(
      'tenant_name', li.tenant_name, 'unit', li.unit_label, 'amount', public.fmt_rwf(li.total_owed),
      'month', public.fmt_month(li.oldest_month), 'due_date', public.fmt_day(r.today + r.grace_days),
      'days_late', li.days_late, 'landlord_name', r.landlord_name)),
    '/?lease=' || li.id || '&month=' || li.oldest_month || '#pay', r.channels
  from run r join lease_info li on li.state = 'over_limit' and li.on_ and r.enabled

  union all
  -- ... and an alert to the landlord.
  select 'over_limit_landlord:' || li.id || ':' || li.oldest_month, r.landlord_id, 'landlord', 'over_limit', 'alert_over_limit',
    li.days_late, li.id, li.oldest_month, 'Tenant over the unpaid rent limit',
    li.tenant_name || ' (' || coalesce(li.unit_label, 'unit') || ') owes ' || public.fmt_rwf(li.total_owed)
      || ', ' || li.days_late || ' days late since ' || public.fmt_month(li.oldest_month)
      || '. Open the unit page to agree a payment plan, give more time or issue a notice to vacate.',
    '/landlord/units/' || (select unit_id from public.leases where id = li.id), r.channels
  from run r join lease_info li on li.state = 'over_limit'

  union all
  -- A missed payment-plan installment: tell both, once per installment.
  select 'plan_missed:' || li.id || ':' || pl.missed_on || ':' || who.aud, case who.aud when 'tenant' then li.tenant_id else r.landlord_id end,
    who.aud, 'warning', case who.aud when 'tenant' then 'rent_warning' else 'alert_plan_missed' end,
    r.today - pl.missed_on, li.id, li.oldest_month,
    'Payment plan installment missed',
    case who.aud when 'tenant'
      then 'Hello ' || li.tenant_name || ', the payment plan installment of ' || public.fmt_rwf(pl.amount) || ' due on '
           || public.fmt_day(pl.missed_on) || ' has not been paid, so reminders have started again. You owe '
           || public.fmt_rwf(li.total_owed) || '. ' || r.landlord_name
      else li.tenant_name || ' (' || coalesce(li.unit_label, 'unit') || ') missed the payment plan installment due on '
           || public.fmt_day(pl.missed_on) || '. Owed: ' || public.fmt_rwf(li.total_owed) || '.' end,
    case who.aud when 'tenant' then '/' else '/landlord/units/' || (select unit_id from public.leases where id = li.id) end,
    r.channels
  from run r
  join lease_info li on true
  cross join lateral public.rent_plan_state(li.id, r.today) pl
  cross join (values ('tenant'), ('landlord')) who(aud)
  where pl.active and not pl.kept and pl.missed_on is not null

  union all
  -- Once a day: tenants at least notify_landlord_after_days late, with amounts.
  select 'late_summary:' || r.today, r.landlord_id, 'landlord', 'summary', 'alert_late_summary',
    r.notify_landlord_after_days, null::uuid, null::text,
    'Tenants with late rent',
    string_agg(li.tenant_name || ' (' || coalesce(li.unit_label, 'unit') || '): ' || public.fmt_rwf(li.total_owed)
               || ', ' || li.days_late || ' days late', '; ' order by li.days_late desc) || '.',
    '/landlord/rent', r.channels
  from run r join lease_info li on li.days_late >= r.notify_landlord_after_days and li.total_owed > 0
  group by r.today, r.landlord_id, r.notify_landlord_after_days, r.channels

  union all
  select 'lease_ending:' || l.id || ':' || l.lease_end, l.tenant_id, 'tenant', 'lease_ending', 'alert_lease_ending',
    r.lease_ending_days, l.id, null::text, 'Lease ending soon',
    'Your lease ends on ' || public.fmt_day(l.lease_end) || '. Contact your landlord to renew or plan your move-out.',
    '/lease', r.channels
  from run r join public.leases l on l.status = 'active' and l.lease_end = r.today + r.lease_ending_days

  union all
  select 'receipt_waiting:' || p.id, r.landlord_id, 'landlord', 'receipt_waiting', 'alert_receipt_waiting',
    r.receipt_waiting_days, p.lease_id, p.period_month, 'Receipt waiting for review',
    coalesce(pr.full_name, 'A tenant') || ' (' || coalesce(u.label, 'unit') || ') submitted ' || public.fmt_rwf(p.amount)
      || ' for ' || public.fmt_month(p.period_month) || ' on '
      || public.fmt_day((p.submitted_at at time zone 'Africa/Kigali')::date) || '. It is still waiting for review.',
    '/landlord/rent', r.channels
  from run r
  join public.payments p on p.status = 'pending_review'
    and (p.submitted_at at time zone 'Africa/Kigali')::date < r.today - r.receipt_waiting_days
  left join public.profiles pr on pr.id = p.tenant_id
  left join public.leases l on l.id = p.lease_id
  left join public.units u on u.id = l.unit_id

  union all
  select 'repair_open:' || m.id, r.landlord_id, 'landlord', 'repair_open', 'alert_repair_open',
    r.repair_open_days, null::uuid, null::text, 'Repair still open',
    coalesce(u.label, 'A unit') || ': ' || left(m.description, 80) || ' (' || replace(m.status, '_', ' ')
      || ' since ' || public.fmt_day((m.created_at at time zone 'Africa/Kigali')::date) || ').',
    '/landlord/maintenance', r.channels
  from run r
  join public.maintenance_requests m on m.status not in ('resolved', 'closed')
    and (m.created_at at time zone 'Africa/Kigali')::date < r.today - r.repair_open_days
  left join public.units u on u.id = m.unit_id;
$$;

do $$
declare f text;
begin
  foreach f in array array['public.due_alerts(timestamptz)', 'public.rent_plan_state(uuid, date)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.rent_limit_status(date)', 'public.alert_settings_current()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- Planner hints: these run hourly over every lease. Realistic row counts and
-- no JIT (compiling took longer than running them).
alter function public.rent_ledger_range(uuid, date, date, date) rows 40 set jit = off;
alter function public.rent_ledger(uuid, date) rows 40 set jit = off;
alter function public.rent_limit_status(date) rows 10 set jit = off;
alter function public.rent_plan_state(uuid, date) rows 1 set jit = off;
alter function public.due_alerts(timestamptz) rows 20 set jit = off;
