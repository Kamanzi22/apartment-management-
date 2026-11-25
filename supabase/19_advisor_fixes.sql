-- ============================================================
-- MIGRATION 19 (DRAFT, NOT APPLIED): the Supabase security advisor leftovers
-- (read 25 Nov 2026, project evzdnnoryffsjpvtacio). Safe to run twice.
-- Independent of 17. Undo: 19_rollback.sql.
--
-- Fixed here:
--   0011 function_search_path_mutable: fmt_rwf, valid_day_list,
--        render_alert_template, fmt_month, fmt_day get a fixed, empty
--        search_path. Their bodies use only built-ins (to_char, round, unnest,
--        jsonb_each_text, replace), which live in pg_catalog and are always found.
--   0028/0029 trigger functions callable over the API: create_alert_settings()
--        and record_maintenance_status() are only meant to run as triggers.
--        Revoking EXECUTE does not stop the triggers (Postgres checks EXECUTE
--        when the trigger is created, not when it fires).
--
-- Left as they are, on purpose (they are the app's API; each checks the caller):
--   attach_tenant, end_tenancy, replace_tenancy (caller_is_admin()),
--   is_landlord, my_unit_id, my_broadcasts_since (used inside RLS policies),
--   rent_limit_status, alert_settings_current (landlord-only results, 18).
-- Not SQL: pg_net in public (moving it means rebuilding the cron job), and
-- "Leaked password protection" (dashboard: Authentication -> Settings).
-- ============================================================

alter function public.fmt_rwf(numeric)                    set search_path = '';
alter function public.valid_day_list(int[])               set search_path = '';
alter function public.render_alert_template(text, jsonb)  set search_path = '';
alter function public.fmt_month(text)                     set search_path = '';
alter function public.fmt_day(date)                       set search_path = '';

revoke execute on function public.create_alert_settings()     from public, anon, authenticated;
revoke execute on function public.record_maintenance_status() from public, anon, authenticated;
grant  execute on function public.create_alert_settings()     to service_role;
grant  execute on function public.record_maintenance_status() to service_role;
