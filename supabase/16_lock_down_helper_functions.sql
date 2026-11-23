-- 16: signed-out visitors can no longer call the RLS helper functions, and three
-- functions get a fixed, empty search_path. Safe to run twice.
--
-- is_landlord() and my_unit_id() are SECURITY DEFINER and were executable by anon
-- through the default PUBLIC grant (Supabase advisor 0028), so revoking from anon
-- alone is not enough: the grant must come off PUBLIC too.
-- Signed-out code never needs them: every signed-out lookup in both apps (sign-in by
-- name/phone, Google sign-in, the cron job) uses the service-role client.
-- Side effect: a signed-out REST query on a table whose policy calls them now fails
-- with "permission denied for function" instead of returning no rows. Both deny.

revoke execute on function public.is_landlord() from public, anon;
revoke execute on function public.my_unit_id()  from public, anon;
grant  execute on function public.is_landlord() to authenticated, service_role;
grant  execute on function public.my_unit_id()  to authenticated, service_role;

-- Bodies use only schema-qualified names (public.profiles, auth.uid()) and pg_catalog
-- built-ins (now()), so an empty search_path changes nothing except closing the hole.
alter function public.is_landlord()    set search_path = '';
alter function public.my_unit_id()     set search_path = '';
alter function public.set_updated_at() set search_path = '';
