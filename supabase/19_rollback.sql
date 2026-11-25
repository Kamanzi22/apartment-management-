-- ROLLBACK for 19_advisor_fixes.sql (NOT APPLIED). Puts back the defaults
-- the functions had before 19 (no search_path setting; EXECUTE for everyone).
alter function public.fmt_rwf(numeric)                    reset search_path;
alter function public.valid_day_list(int[])               reset search_path;
alter function public.render_alert_template(text, jsonb)  reset search_path;
alter function public.fmt_month(text)                     reset search_path;
alter function public.fmt_day(date)                       reset search_path;

grant execute on function public.create_alert_settings()     to public, anon, authenticated;
grant execute on function public.record_maintenance_status() to public, anon, authenticated;
