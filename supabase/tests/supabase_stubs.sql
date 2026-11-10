-- Minimal stand-ins for the parts of Supabase the migrations rely on, so the
-- migrations can be applied to a plain Postgres 16 for testing.
-- NEVER run this against the real Supabase project.

-- API roles, as in Supabase. PostgREST logs in as "authenticator" and then
-- switches to anon / authenticated / service_role.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'authenticator';
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;

-- auth schema
create schema if not exists auth;
create table if not exists auth.users (
  id           uuid primary key,
  email        text unique,
  banned_until timestamptz,
  created_at   timestamptz not null default now()
);

-- Same definition Supabase uses: '' (pooled connections) must not break it.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  );
$$;

-- storage schema
create schema if not exists storage;
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now()
);
create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text,
  owner      uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;

-- Grants, as Supabase sets them up.
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant select on all tables in schema auth to service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
