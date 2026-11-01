// api/delete-account.js — deletes everything Synth BI holds for the
// signed-in account: dashboards, their table rows, the table data in
// Storage (bucket "dashboard-data", under <user id>/...) and AI request
// times.
//
// Synth BI has no accounts of its own: people sign in with their Synth
// (synth-sql.com) account, and the auth user lives in synth-sql's Supabase
// project. So:
//   POST /api/delete-account          deletes Synth BI's data only. Called
//                                     by synth-sql.com's own
//                                     /api/delete-account before it deletes
//                                     the auth user.
//   POST /api/delete-account?full=1   what Synth BI's Account panel calls:
//                                     deletes Synth BI's data, then asks
//                                     synth-sql.com to delete the account
//                                     itself (which calls back here, by
//                                     then a no-op).
//
// SYNTH_SQL_URL overrides where that second call goes (default
// https://synth-sql.com).

import { getVerifiedUserId } from './_supabaseAuth.js';
import { getSupabaseAdmin } from './_supabaseAdmin.js';

const DATA_BUCKET = 'dashboard-data';

// Storage's list() isn't recursive; a folder entry comes back with id null.
export async function listAllPaths(supabase, prefix) {
  const paths = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage.from(DATA_BUCKET).list(prefix, { limit: pageSize, offset });
    if (error) throw new Error(error.message);
    for (const entry of data) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id === null) paths.push(...await listAllPaths(supabase, path));
      else paths.push(path);
    }
    if (data.length < pageSize) break;
  }
  return paths;
}

export async function deleteBiData(supabase, userId) {
  const paths = await listAllPaths(supabase, userId);
  for (let i = 0; i < paths.length; i += 1000) {
    const { error } = await supabase.storage.from(DATA_BUCKET).remove(paths.slice(i, i + 1000));
    if (error) throw new Error(error.message);
  }
  // dashboard_tables rows cascade from dashboards; deleted explicitly too
  // in case any were left pointing at a dashboard that's already gone.
  for (const table of ['dashboard_tables', 'dashboards', 'ai_usage_events']) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId);
    if (error) throw new Error(error.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const userId = await getVerifiedUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Sign in again, then try deleting your account.' });
    return;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(503).json({ error: 'Saved dashboards are not configured on the server yet' });
    return;
  }

  try {
    await deleteBiData(supabase, userId);
  } catch (err) {
    res.status(500).json({ error: `Couldn't delete your Synth BI data (${err.message}). Email synth.sql@gmail.com and we'll finish it by hand.` });
    return;
  }

  if (req.query?.full !== '1') {
    res.status(200).json({ deleted: true });
    return;
  }

  const base = (process.env.SYNTH_SQL_URL || 'https://synth-sql.com').replace(/\/$/, '');
  try {
    const r = await fetch(`${base}/api/delete-account`, {
      method: 'POST',
      headers: { Authorization: req.headers['authorization'] },
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      res.status(r.status).json({ error: `Your Synth BI dashboards were deleted, but your account wasn't: ${body?.error?.message || `request failed (${r.status})`}` });
      return;
    }
  } catch (err) {
    res.status(502).json({ error: `Your Synth BI dashboards were deleted, but we couldn't reach Synth to delete your account (${err.message}). Try again, or email synth.sql@gmail.com.` });
    return;
  }
  res.status(200).json({ deleted: true, account: true });
}
