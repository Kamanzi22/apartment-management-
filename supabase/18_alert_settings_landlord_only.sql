-- 18: alert_settings_current() returns rows to the landlord only.
-- ALREADY APPLIED to production on 2026-11-25 (version 20261125042655).
-- This file is the same SQL, saved for the record. Do not re-apply.
-- Closes the attack-test FAIL: a tenant could read the landlord's alert settings and templates.

create or replace function public.alert_settings_current()
 returns setof public.alert_settings
 language sql stable security definer
 set search_path to 'public'
as $function$
  select * from public.alert_settings
  where landlord_id = public.primary_landlord_id()
    and public.is_landlord();
$function$;

revoke execute on function public.alert_settings_current() from public, anon;
grant execute on function public.alert_settings_current() to authenticated;
