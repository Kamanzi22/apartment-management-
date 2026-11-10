-- ============================================================
-- MIGRATION 10: Several payments per month (partial payments / top-ups),
-- paying up to 6 months ahead, and former tenants paying what they owe.
-- Apply after 09.
-- ============================================================

-- 1. Drop UNIQUE (lease_id, period_month), whatever it is called.
do $$
declare c text;
begin
  for c in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.payments'::regclass and con.contype = 'u'
      and (select array_agg(a.attname::text order by a.attname)
             from unnest(con.conkey) k join pg_attribute a
               on a.attrelid = con.conrelid and a.attnum = k)
          = array['lease_id', 'period_month']
  loop
    execute format('alter table public.payments drop constraint %I', c);
  end loop;
end $$;

create index if not exists payments_lease_period_idx on public.payments (lease_id, period_month);

-- Sanity checks for new rows (NOT VALID: existing rows are left alone).
alter table public.payments drop constraint if exists payments_amount_positive;
alter table public.payments add constraint payments_amount_positive check (amount > 0) not valid;
alter table public.payments drop constraint if exists payments_period_format;
alter table public.payments add constraint payments_period_format
  check (period_month ~ '^\d{4}-(0[1-9]|1[0-2])$') not valid;

-- 2. Tenants only ever INSERT payments. A rejected receipt stays in the
--    history as rejected; resubmitting adds a new pending_review row.
drop policy if exists "payments: tenant updates own pending" on public.payments;
drop policy if exists "payments: tenant updates own pending or rejected" on public.payments;
drop policy if exists "payments: tenant inserts own" on public.payments;
create policy "payments: tenant inserts own" on public.payments for insert
  with check (tenant_id = auth.uid() and status = 'pending_review');

-- 3. Guard: what a tenant may submit.
--    Active lease: any month from move-in up to 6 months after the current
--    Kigali month (and not after lease_end).
--    Ended lease (former tenant): only a month that still has a balance, and
--    no more than that balance.
create or replace function public.guard_payment_changes()
returns trigger language plpgsql set search_path = public as $$
declare
  l public.leases%rowtype;
  v_today date := public.app_today();
  v_max_month text := to_char(date_trunc('month', v_today::timestamp) + interval '6 months', 'YYYY-MM');
  v_owed numeric;
begin
  if public.is_service_role() or public.is_landlord() then return new; end if;

  if tg_op = 'UPDATE' then
    raise exception 'A submitted payment cannot be changed. Submit a new payment instead.'
      using errcode = '42501';
  end if;

  select * into l from public.leases where id = new.lease_id and tenant_id = auth.uid();
  if not found then
    raise exception 'Payment must be for your own lease' using errcode = '42501';
  end if;
  if new.amount is null or new.amount <= 0 then
    raise exception 'Amount must be more than zero';
  end if;
  if new.period_month is null or new.period_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'Month must look like YYYY-MM';
  end if;
  if new.period_month < to_char(l.move_in_date, 'YYYY-MM') then
    raise exception 'That month is before your lease started';
  end if;
  if l.lease_end is not null and new.period_month > to_char(l.lease_end, 'YYYY-MM') then
    raise exception 'That month is after your lease ends';
  end if;

  if l.status = 'active' then
    if new.period_month > v_max_month then
      raise exception 'You can pay at most 6 months ahead';
    end if;
  else
    select r.balance - r.pending_paid into v_owed
    from public.rent_ledger(l.id, v_today) r
    where r.period_month = new.period_month;
    if coalesce(v_owed, 0) <= 0 then
      raise exception 'Nothing is owed for that month';
    end if;
    if new.amount > v_owed then
      raise exception 'You can pay at most the balance owed for that month (% RWF)', v_owed;
    end if;
  end if;

  new.tenant_id := auth.uid();
  new.status := 'pending_review'; new.reviewed_by := null; new.reviewed_at := null;
  new.landlord_notes := null; new.submitted_at := now();
  return new;
end;
$$;

drop trigger if exists payments_guard on public.payments;
create trigger payments_guard before insert or update on public.payments
  for each row execute function public.guard_payment_changes();
