-- supabase/schema.sql — the full synth-bi schema in one readable file.
-- Authoritative, versioned source: supabase/migrations/ (applied with
-- `supabase db push` after `supabase link --project-ref fvjlqcrjfbxgqjbbqdaa`
-- — see BUILD-INSTRUCTIONS.md §7). Keep this file in sync when adding a
-- migration; never paste it into the dashboard SQL editor by hand.

-- synth-bi initial schema (applied with `supabase db push`; mirrored in
-- supabase/schema.sql for reading). Adapted from synth-sql's schema.sql:
-- kept the per-user workspace + datasets + Storage pattern and
-- ai_usage_events; dropped profiles/premium, organizations, and landing
-- gates (no paid tier, no orgs — initial-build.md §7).
--
-- A dashboard row is the whole saved workspace except the table data:
-- tiles, canvas settings, confirmed relationships, and chat history as
-- jsonb (they're always read and written together, so one row keeps saves
-- atomic and autosave cheap). Each table's rows live in Storage as gzipped
-- JSON (lossless — CSV round-trips lose embedded newlines and quotes), with
-- one dashboard_tables row of metadata pointing at the object.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- dashboards
-- ---------------------------------------------------------------------------
create table if not exists public.dashboards (
  id uuid primary key default gen_random_uuid(),
  -- Not FK'd to auth.users: auth lives in synth-sql's Supabase project now
  -- (see 20260925210000_drop_auth_users_fk.sql), so this project's own
  -- auth.users table never gets a row for these ids.
  user_id uuid not null default auth.uid(),
  name text not null default 'Untitled dashboard' check (char_length(name) between 1 and 200),
  tiles jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  relationships jsonb not null default '[]'::jsonb,
  chat_history jsonb not null default '[]'::jsonb,
  thumbnail text check (thumbnail is null or char_length(thumbnail) < 400000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dashboards_payload_size check (
    pg_column_size(tiles) + pg_column_size(settings) + pg_column_size(relationships) + pg_column_size(chat_history) < 4000000
  )
);

create index if not exists dashboards_user_updated_idx on public.dashboards (user_id, updated_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dashboards_touch_updated_at on public.dashboards;
create trigger dashboards_touch_updated_at
  before update on public.dashboards
  for each row execute function public.touch_updated_at();

alter table public.dashboards enable row level security;

create policy "dashboards: owner full access"
  on public.dashboards for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- dashboard_tables — one row per table in a saved dashboard
-- ---------------------------------------------------------------------------
create table if not exists public.dashboard_tables (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  table_name text not null,
  file_name text,
  source_type text check (source_type in ('csv', 'json', 'xlsx')),
  sheet_name text,
  row_count integer not null default 0,
  columns jsonb not null default '[]'::jsonb,
  storage_path text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (dashboard_id, table_name)
);

create index if not exists dashboard_tables_dashboard_idx on public.dashboard_tables (dashboard_id, position);

alter table public.dashboard_tables enable row level security;

create policy "dashboard_tables: owner full access via dashboard"
  on public.dashboard_tables for all
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (select 1 from public.dashboards d where d.id = dashboard_tables.dashboard_id and d.user_id = (select auth.uid()))
  )
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.dashboards d where d.id = dashboard_tables.dashboard_id and d.user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- ai_usage_events — read/written only by api/_aiRateLimit.js with the
-- service-role key. RLS on with zero policies, so anon/authenticated get
-- nothing even if a client ever queries it by mistake (same as synth-sql).
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_events_user_time_idx on public.ai_usage_events (user_id, created_at desc);

alter table public.ai_usage_events enable row level security;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for table data, one folder per user:
--   <user_id>/<dashboard_id>/<table_name>.json.gz
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dashboard-data', 'dashboard-data', false, 52428800, array['application/gzip', 'application/json'])
on conflict (id) do nothing;

create policy "dashboard-data: owner can read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'dashboard-data' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "dashboard-data: owner can upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'dashboard-data' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "dashboard-data: owner can update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'dashboard-data' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'dashboard-data' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "dashboard-data: owner can delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'dashboard-data' and (storage.foldername(name))[1] = (select auth.uid())::text);
