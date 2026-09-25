// api/_aiRateLimit.js — ported from synth-sql. Burst + daily per-account AI
// usage limits. Synth-sql split the daily limit by is_premium and let an
// org admin switch AI off; synth-bi has no paid tier and no orgs
// (initial-build.md §7), so this collapses to one flat daily limit for every
// signed-in account.
//
// Reads/writes public.ai_usage_events with the service-role key (RLS on,
// zero policies — see supabase/migrations). Without SUPABASE_SERVICE_ROLE_KEY
// the admin client is null and this fails open: AI works, just unmetered.
// Fine for local development, not for production.
//
// Not itself a route — no default export, so Vercel only bundles it for
// api/chat.js.

import { createClient } from '@supabase/supabase-js';

let cachedClient;

function getSupabaseAdmin() {
  if (cachedClient !== undefined) return cachedClient;
  cachedClient = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  return cachedClient;
}

const BURST_LIMIT = 15;
const BURST_WINDOW_MINUTES = 5;
const DAILY_LIMIT = 100;

// Checks both limits and, if the request is allowed, records it in the same
// call — callers should treat a rejected result as "don't forward to Groq."
// Known, accepted gap (same as synth-sql): check-then-insert isn't atomic,
// so two requests landing within milliseconds could overshoot by one.
export async function checkAndRecordAiUsage(userId) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { allowed: true }; // fail open if the service key isn't configured

  const now = Date.now();
  const burstSince = new Date(now - BURST_WINDOW_MINUTES * 60_000).toISOString();
  const daySince = new Date(now - 24 * 60 * 60_000).toISOString();

  const { count: burstCount, error: burstError } = await supabase
    .from('ai_usage_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', burstSince);
  if (burstError) {
    console.error('AI rate limit check failed:', burstError.message);
    return { allowed: true };
  }
  if (burstCount >= BURST_LIMIT) {
    return { allowed: false, message: "You're sending messages faster than the assistant can keep up. Wait a few minutes and try again." };
  }

  const { count: dailyCount } = await supabase
    .from('ai_usage_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', daySince);
  if (dailyCount >= DAILY_LIMIT) {
    return { allowed: false, message: "You've used today's AI messages. The limit resets on a rolling 24-hour basis, so try again in a bit." };
  }

  await supabase.from('ai_usage_events').insert({ user_id: userId });
  return { allowed: true };
}
