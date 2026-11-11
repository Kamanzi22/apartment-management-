-- ============================================================
-- MIGRATION 14: Tenants report repairs; only the landlord sets the status.
-- Apply after 13.
-- ============================================================

alter table public.maintenance_requests drop constraint if exists maintenance_requests_status_check;
alter table public.maintenance_requests add constraint maintenance_requests_status_check
  check (status in ('submitted', 'acknowledged', 'scheduled', 'in_progress', 'on_hold', 'resolved', 'closed'));
alter table public.maintenance_requests add column if not exists scheduled_for date;

-- Tenants choose whether status changes are also emailed to them.
alter table public.profiles add column if not exists email_notifications boolean not null default true;

-- ── Status history, written by a trigger ─────────────────────
create table if not exists public.maintenance_status_history (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.maintenance_requests(id) on delete cascade,
  from_status text,
  to_status   text not null,
  comment     text,
  changed_by  uuid references public.profiles(id) on delete set null,
  changed_at  timestamptz not null default now()
);
create index if not exists maintenance_status_history_req_idx
  on public.maintenance_status_history (request_id, changed_at);
alter table public.maintenance_status_history enable row level security;
drop policy if exists "maintenance_history: landlord full access" on public.maintenance_status_history;
create policy "maintenance_history: landlord full access" on public.maintenance_status_history for all
  using (public.is_landlord()) with check (public.is_landlord());
drop policy if exists "maintenance_history: tenant reads own" on public.maintenance_status_history;
create policy "maintenance_history: tenant reads own" on public.maintenance_status_history for select
  using (exists (select 1 from public.maintenance_requests m
                 where m.id = request_id and m.tenant_id = auth.uid()));

-- Existing requests get a starting entry.
insert into public.maintenance_status_history (request_id, from_status, to_status, changed_at)
select m.id, null, m.status, m.created_at from public.maintenance_requests m
where not exists (select 1 from public.maintenance_status_history h where h.request_id = m.id);

create or replace function public.record_maintenance_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.maintenance_status_history (request_id, from_status, to_status, comment, changed_by, changed_at)
    values (new.id, null, new.status, null, new.tenant_id, new.created_at);
  elsif new.status is distinct from old.status then
    insert into public.maintenance_status_history (request_id, from_status, to_status, comment, changed_by)
    values (new.id, old.status, new.status, new.landlord_comment, auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists maintenance_status_history_trg on public.maintenance_requests;
create trigger maintenance_status_history_trg after insert or update of status on public.maintenance_requests
  for each row execute function public.record_maintenance_status();

-- ── Only the landlord (or the service role) changes or deletes a request ─
-- Tenants have no UPDATE or DELETE policy either; this is the second lock.
create or replace function public.guard_maintenance_changes()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_service_role() or public.is_landlord() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Only the landlord can change a maintenance request' using errcode = '42501';
end;
$$;
drop trigger if exists maintenance_guard on public.maintenance_requests;
create trigger maintenance_guard before update or delete on public.maintenance_requests
  for each row execute function public.guard_maintenance_changes();

-- A tenant's new request starts as 'submitted' (the column default; the tenant
-- app does not send a status) and anything else is refused, so an attempt to
-- file a request as 'resolved' fails instead of being quietly rewritten.
drop trigger if exists maintenance_insert_defaults on public.maintenance_requests;
drop function if exists public.maintenance_starts_submitted();
drop policy if exists "maintenance: tenant inserts own" on public.maintenance_requests;
create policy "maintenance: tenant inserts own" on public.maintenance_requests for insert
  with check (tenant_id = auth.uid() and unit_id = public.my_unit_id()
    and status = 'submitted' and landlord_comment is null and scheduled_for is null);

-- ── Tenant follow-ups ("still leaking", a new photo) ─────────
create table if not exists public.maintenance_updates (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.maintenance_requests(id) on delete cascade,
  author_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body        text not null check (length(trim(body)) between 1 and 2000),
  photo_paths text[] not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists maintenance_updates_req_idx on public.maintenance_updates (request_id, created_at);
alter table public.maintenance_updates enable row level security;
drop policy if exists "maintenance_updates: landlord full access" on public.maintenance_updates;
create policy "maintenance_updates: landlord full access" on public.maintenance_updates for all
  using (public.is_landlord()) with check (public.is_landlord());
drop policy if exists "maintenance_updates: tenant reads own" on public.maintenance_updates;
create policy "maintenance_updates: tenant reads own" on public.maintenance_updates for select
  using (exists (select 1 from public.maintenance_requests m
                 where m.id = request_id and m.tenant_id = auth.uid()));
drop policy if exists "maintenance_updates: tenant adds to own open request" on public.maintenance_updates;
create policy "maintenance_updates: tenant adds to own open request" on public.maintenance_updates for insert
  with check (author_id = auth.uid()
    and exists (select 1 from public.maintenance_requests m
                where m.id = request_id and m.tenant_id = auth.uid()
                  and m.status not in ('resolved', 'closed')));
