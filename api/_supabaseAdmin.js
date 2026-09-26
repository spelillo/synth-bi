// api/_supabaseAdmin.js — service-role client for synth-bi's own data
// project (fvjlqcrjfbxgqjbbqdaa). Used by the api/dashboards/* routes to
// read/write dashboards, dashboard_tables, and Storage on behalf of a
// caller already verified against synth-sql's Auth (getVerifiedUserId in
// _supabaseAuth.js) — every query here must filter by that verified user
// id explicitly, since the service role bypasses RLS entirely.
//
// This exists because synth-bi's auth and data now live in two different
// Supabase projects, and Supabase has no supported way to make one
// project's Postgres trust a JWT signed by a different project's Auth
// (Third-Party Auth is for external identity providers like Clerk/Auth0,
// not for another Supabase project). Routing data access through this
// server-side client, gated on a token verified against the real auth
// project, is the standard shape for that situation.
//
// Not itself a route: it has no default export, so Vercel doesn't turn it
// into an endpoint, only bundles it for the files that import it.

import { createClient } from '@supabase/supabase-js';

const DATA_SUPABASE_URL_FALLBACK = 'https://fvjlqcrjfbxgqjbbqdaa.supabase.co';

let cachedClient;

export function getSupabaseAdmin() {
  if (cachedClient !== undefined) return cachedClient;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cachedClient = key
    ? createClient(process.env.SUPABASE_URL || DATA_SUPABASE_URL_FALLBACK, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
  return cachedClient;
}
