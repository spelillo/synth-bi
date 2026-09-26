-- 20260925210000_drop_auth_users_fk.sql — auth moved to synth-sql's Supabase
-- project (see auth.js, api/_supabaseAuth.js). This project's own
-- auth.users table is no longer where signed-in users come from, so a
-- user_id column referencing it here can never resolve: every insert would
-- fail its foreign key check the moment Third-Party Auth is wired up
-- (Authentication -> Third-Party Auth, added for synth-sql's project, is a
-- Supabase dashboard step, not a migration).
--
-- user_id stays a uuid `default auth.uid()` and RLS keeps comparing it
-- against `auth.uid()` — both keep working once Third-Party Auth is
-- configured, since Postgres then resolves `auth.uid()` from the same JWT
-- `sub` claim regardless of which project's Auth service signed it. Only
-- the foreign key, which can only ever point at a table in this same
-- database, has to go.
alter table public.dashboards drop constraint if exists dashboards_user_id_fkey;
alter table public.dashboard_tables drop constraint if exists dashboard_tables_user_id_fkey;
alter table public.ai_usage_events drop constraint if exists ai_usage_events_user_id_fkey;
