-- MIGRATION 08: Security hardening + tenant -> landlord alerts
create or replace function public.is_service_role()
returns boolean language sql stable set search_path = public as $$
  -- nullif(...,''): on pooled connections the setting can be '' (not NULL), and ''::jsonb errors
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') = 'service_role'
      or current_user in ('postgres', 'supabase_admin', 'service_role');
$$;
create or replace function public.is_landlord()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'landlord');
$$;
create or replace function public.my_unit_id()
returns uuid language sql security definer stable set search_path = public as $$
  select unit_id from public.profiles where id = auth.uid();
$$;
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
revoke execute on function public.is_landlord() from anon;
revoke execute on function public.my_unit_id() from anon;

-- Tenants may not change their own role or unit (they could make themselves landlord)
create or replace function public.guard_profile_changes()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_service_role() or public.is_landlord() then return new; end if;
  if new.role is distinct from old.role or new.unit_id is distinct from old.unit_id then
    raise exception 'Not allowed to change role or unit';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_changes();

-- Tenants only submit/resubmit as pending_review, on their own active lease
create or replace function public.guard_payment_changes()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_service_role() or public.is_landlord() then return new; end if;
  if not exists (select 1 from public.leases l
                 where l.id = new.lease_id and l.tenant_id = auth.uid() and l.status = 'active') then
    raise exception 'Payment must be for your own active lease';
  end if;
  new.status := 'pending_review'; new.reviewed_by := null; new.reviewed_at := null;
  new.landlord_notes := null; new.submitted_at := now();
  return new;
end;
$$;
drop trigger if exists payments_guard on public.payments;
create trigger payments_guard before insert or update on public.payments
  for each row execute function public.guard_payment_changes();

drop policy if exists "payments: tenant updates own pending" on public.payments;
drop policy if exists "payments: tenant updates own pending or rejected" on public.payments;
create policy "payments: tenant updates own pending or rejected" on public.payments for update
  using (tenant_id = auth.uid() and status in ('pending_review', 'rejected'))
  with check (tenant_id = auth.uid() and status = 'pending_review');
drop policy if exists "payments: tenant inserts own" on public.payments;
create policy "payments: tenant inserts own" on public.payments for insert
  with check (tenant_id = auth.uid() and status = 'pending_review');

-- Tenants may alert the landlord (previously every tenant alert was blocked)
drop policy if exists "notifications: tenant alerts landlord" on public.notifications;
create policy "notifications: tenant alerts landlord" on public.notifications for insert
  with check (auth.uid() is not null
    and exists (select 1 from public.profiles p where p.id = user_id and p.role = 'landlord'));

-- Tenants may only message the landlord (no broadcasts, no tenant-to-tenant)
drop policy if exists "messages: tenant inserts own" on public.messages;
create policy "messages: tenant inserts own" on public.messages for insert
  with check (sender_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = recipient_id and p.role = 'landlord'));

-- Tenants create repairs as 'submitted' with no landlord comment
drop policy if exists "maintenance: tenant inserts own" on public.maintenance_requests;
create policy "maintenance: tenant inserts own" on public.maintenance_requests for insert
  with check (tenant_id = auth.uid() and unit_id = public.my_unit_id()
    and status = 'submitted' and landlord_comment is null);

-- Move-out notices only for your own lease
drop policy if exists "move_out: tenant inserts own" on public.move_out_notices;
create policy "move_out: tenant inserts own" on public.move_out_notices for insert
  with check (tenant_id = auth.uid()
    and exists (select 1 from public.leases l where l.id = lease_id and l.tenant_id = auth.uid()));
