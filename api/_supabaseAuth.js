// api/_supabaseAuth.js — ported from synth-sql: verifies the bearer token on
// incoming requests and resolves it to a Supabase user id. Shared by
// api/chat.js and any future signed-in-only endpoint. Never trusts a
// client-supplied user id.
//
// One change from synth-sql: verifying a user's access token doesn't need
// the service-role key — auth.getUser(token) works with the project's public
// (publishable) key too. synth-sql built this client with the service key
// only, so until SUPABASE_SERVICE_ROLE_KEY is set every request looked
// signed out and the AI returned 401. Now the service key is only needed by
// _aiRateLimit.js (metering); sign-in verification works without it.
//
// Not itself a route: it has no default export, so Vercel doesn't turn it
// into an endpoint, only bundles it for the files that import it.

import { createClient } from '@supabase/supabase-js';

// Public by design (same value auth.js ships to every browser) — only used
// as a fallback when SUPABASE_ANON_KEY isn't set in the environment.
const PUBLISHABLE_KEY_FALLBACK = 'sb_publishable_KSbBry-RR0L4QnSUT5k8Kg_kLF3PkjX';

let cachedClient;

function getVerifierClient() {
  if (cachedClient !== undefined) return cachedClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || PUBLISHABLE_KEY_FALLBACK;
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
