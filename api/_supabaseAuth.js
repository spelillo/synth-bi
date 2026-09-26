// api/_supabaseAuth.js — ported from synth-sql: verifies the bearer token on
// incoming requests and resolves it to a Supabase user id. Shared by
// api/chat.js and any future signed-in-only endpoint. Never trusts a
// client-supplied user id.
//
// Auth moved to synth-sql's Supabase project (auth.js on the client side
// signs in against it too), so a token from the browser is only verifiable
// against synth-sql's project now, not synth-bi's own. This client is
// verification-only; it's never used to read/write synth-bi's own data
// tables, which stay on synth-bi's project (see auth.js's `sbData` client).
//
// Verifying a user's access token doesn't need the service-role key —
// auth.getUser(token) works with the project's public (publishable) key
// too. The service key is only needed by _aiRateLimit.js (metering).
//
// Not itself a route: it has no default export, so Vercel doesn't turn it
// into an endpoint, only bundles it for the files that import it.

import { createClient } from '@supabase/supabase-js';

// Public by design (same value synth-sql's auth.js ships to every browser)
// — only used as a fallback when SUPABASE_AUTH_ANON_KEY isn't set.
const PUBLISHABLE_KEY_FALLBACK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1a3hwaWt0aHJ5YXN5bWZ1aGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwMDAyNTQsImV4cCI6MjEwNDU3NjI1NH0.NFhryLa7MLSvjRGnT75EfxH_4M9tACdbVWOlmaLSXbw';
// Also public (synth-sql's auth.js ships it) — used when SUPABASE_AUTH_URL
// isn't set. This is synth-sql's project, not synth-bi's own.
export const SUPABASE_URL_FALLBACK = 'https://gukxpikthryasymfuhgl.supabase.co';

let cachedClient;

function getVerifierClient() {
  if (cachedClient !== undefined) return cachedClient;
  const url = process.env.SUPABASE_AUTH_URL || SUPABASE_URL_FALLBACK;
  const key = process.env.SUPABASE_AUTH_SERVICE_ROLE_KEY || process.env.SUPABASE_AUTH_ANON_KEY || PUBLISHABLE_KEY_FALLBACK;
  cachedClient = url ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  return cachedClient;
}

export async function getVerifiedUserId(req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabase = getVerifierClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user.id;
}
