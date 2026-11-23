-- 15: the two extensions the hourly alerts job needs (pg_cron runs it, pg_net makes the HTTP call).
-- Safe to run twice. Production already has both (enabled by hand in the dashboard on 20 Nov 2026,
-- pg_net in the "public" schema, which is why the security advisor shows "Extension in Public";
-- moving it means dropping and recreating it, so leave it until the job is rebuilt).
-- The job itself holds a secret, so it is NOT in this file: see "Scheduled alerts" in README.md.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
