// api/cron/data-retention.js — Vercel Cron Job (see vercel.json "crons"),
// daily. Deletes AI request times older than 30 days. They exist only for
// the rate limit in api/_aiRateLimit.js, which looks back 24 hours. The
// privacy policy states the same period: change both together.
//
// Protected by CRON_SECRET: Vercel sends `Authorization: Bearer
// <CRON_SECRET>` with its own cron calls when that env var is set.

import { getSupabaseAdmin } from '../_supabaseAdmin.js';

export const AI_USAGE_RETENTION_DAYS = 30;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || (req.headers['authorization'] || '') !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(503).json({ error: 'Server is not configured (Supabase)' });
    return;
  }
  const cutoff = new Date(Date.now() - AI_USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('ai_usage_events').delete().lt('created_at', cutoff);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(200).json({ ok: true, cutoff });
}
