-- ============================================================
-- MIGRATION 11: Broadcast privacy, per-user broadcast reads, former tenants
-- keep read-only access, and all-or-nothing move-in / move-out / replace.
-- Apply after 10.
-- ============================================================

-- Who may run landlord-only SECURITY DEFINER functions. Inside a SECURITY
-- DEFINER function current_user is the owner, so is_service_role() would
-- always be true there; check the JWT and the login role instead.
create or replace function public.caller_is_admin()
returns boolean language sql stable set search_path = public as $$
  select public.is_landlord()
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') = 'service_role'
      or session_user in ('postgres', 'supabase_admin');
$$;

-- ── Broadcasts: a tenant sees only those sent since their current lease began
create or replace function public.my_broadcasts_since()
returns timestamptz language sql security definer stable set search_path = public as $$
  select coalesce(
    (select (max(l.lease_start)::timestamp at time zone 'Africa/Kigali')
       from public.leases l where l.tenant_id = auth.uid() and l.status = 'active'),
    'infinity'::timestamptz);
$$;
revoke execute on function public.my_broadcasts_since() from public, anon;
grant execute on function public.my_broadcasts_since() to authenticated, service_role;

drop policy if exists "messages: tenant reads own" on public.messages;
create policy "messages: tenant reads own" on public.messages for select
  using (sender_id = auth.uid()
      or recipient_id = auth.uid()
      or (recipient_id is null and created_at >= public.my_broadcasts_since()));

-- Direct messages only; broadcast reads are tracked per user in message_reads.
drop policy if exists "messages: tenant marks read" on public.messages;
create policy "messages: tenant marks read" on public.messages for update
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- A recipient may only set read_at, never rewrite the message.
create or replace function public.guard_message_changes()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_service_role() or public.is_landlord() then return new; end if;
  if new.sender_id is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at then
    raise exception 'Only read_at can be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_guard on public.messages;
create trigger messages_guard before update on public.messages
  for each row execute function public.guard_message_changes();

create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_reads enable row level security;

drop policy if exists "message_reads: own" on public.message_reads;
create policy "message_reads: own" on public.message_reads for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.messages m
                where m.id = message_id and m.recipient_id is null));
drop policy if exists "message_reads: landlord reads" on public.message_reads;
create policy "message_reads: landlord reads" on public.message_reads for select
  using (public.is_landlord());

create index if not exists messages_created_idx on public.messages (created_at desc);
create index if not exists messages_pair_idx on public.messages (sender_id, recipient_id, created_at desc);

-- ── Former tenants keep read access to the unit(s) they rented
drop policy if exists "units: tenant reads units of own leases" on public.units;
create policy "units: tenant reads units of own leases" on public.units for select
  using (exists (select 1 from public.leases l
                 where l.unit_id = units.id and l.tenant_id = auth.uid()));

-- ── Move-in / move-out / replace, each in one transaction
-- The login itself is never disabled here; "Archive tenant" in the app does that.
create or replace function public.end_tenancy(p_lease uuid, p_move_out date)
returns void language plpgsql security definer set search_path = public as $$
declare l public.leases%rowtype;
begin
  if not public.caller_is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into l from public.leases where id = p_lease for update;
  if not found then raise exception 'Lease not found'; end if;
  if l.status <> 'active' then raise exception 'That lease has already ended'; end if;
  if p_move_out is null or p_move_out < l.move_in_date then
    raise exception 'Move-out date cannot be before the move-in date';
  end if;

  update public.leases set status = 'ended', lease_end = p_move_out where id = p_lease;
  update public.profiles set unit_id = null where id = l.tenant_id and unit_id = l.unit_id;
  update public.units set status = 'vacant'
   where id = l.unit_id
     and not exists (select 1 from public.leases x where x.unit_id = l.unit_id and x.status = 'active');
  update public.move_out_notices set status = 'acknowledged'
   where lease_id = p_lease and status = 'submitted';
end;
$$;

create or replace function public.attach_tenant(
  p_tenant uuid, p_full_name text, p_phone text, p_unit uuid,
  p_move_in date, p_rent numeric, p_deposit numeric, p_lease_end date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles%rowtype;
  v_lease uuid;
begin
  if not public.caller_is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Full name is required'; end if;
  if p_move_in is null then raise exception 'Move-in date is required'; end if;
  if p_rent is null or p_rent <= 0 then raise exception 'Monthly rent must be more than zero'; end if;
  if p_lease_end is not null and p_lease_end < p_move_in then
    raise exception 'Lease end cannot be before move-in';
  end if;

  perform 1 from public.units where id = p_unit for update;
  if not found then raise exception 'Unit not found'; end if;
  if exists (select 1 from public.leases where unit_id = p_unit and status = 'active') then
    raise exception 'This unit already has an active tenant';
  end if;

  select * into v_profile from public.profiles where id = p_tenant for update;
  if found then
    if v_profile.role <> 'tenant' then
      raise exception 'That email is already in use by a non-tenant account.';
    end if;
    if v_profile.unit_id is not null
       or exists (select 1 from public.leases where tenant_id = p_tenant and status = 'active') then
      raise exception 'That email belongs to a tenant currently assigned to another unit.';
    end if;
    update public.profiles
       set full_name = trim(p_full_name), phone = nullif(trim(coalesce(p_phone, '')), ''), unit_id = p_unit
     where id = p_tenant;
  else
    insert into public.profiles (id, role, full_name, phone, unit_id)
    values (p_tenant, 'tenant', trim(p_full_name), nullif(trim(coalesce(p_phone, '')), ''), p_unit);
  end if;

  insert into public.leases (unit_id, tenant_id, move_in_date, rent_due_day, monthly_rent,
                             deposit_amount, lease_start, lease_end, status)
  values (p_unit, p_tenant, p_move_in, extract(day from p_move_in)::int, p_rent,
          coalesce(p_deposit, 0), p_move_in, p_lease_end, 'active')
  returning id into v_lease;

  update public.units set status = 'occupied', monthly_rent = p_rent where id = p_unit;
  return v_lease;
end;
$$;

-- Ends the old tenancy and starts the new one, or does nothing at all.
create or replace function public.replace_tenancy(
  p_old_lease uuid, p_move_out date,
  p_tenant uuid, p_full_name text, p_phone text, p_unit uuid,
  p_move_in date, p_rent numeric, p_deposit numeric, p_lease_end date)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.caller_is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.leases where id = p_old_lease and unit_id = p_unit) then
    raise exception 'The outgoing lease is not on this unit';
  end if;
  perform public.end_tenancy(p_old_lease, p_move_out);
  return public.attach_tenant(p_tenant, p_full_name, p_phone, p_unit,
                              p_move_in, p_rent, p_deposit, p_lease_end);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.caller_is_admin()',
    'public.end_tenancy(uuid, date)',
    'public.attach_tenant(uuid, text, text, uuid, date, numeric, numeric, date)',
    'public.replace_tenancy(uuid, date, uuid, text, text, uuid, date, numeric, numeric, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
