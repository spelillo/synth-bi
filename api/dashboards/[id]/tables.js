// api/dashboards/[id]/tables.js — replaces a dashboard's saved tables
// wholesale (same approach the client used to take directly): drops the
// old dashboard_tables rows and their Storage objects, then for each new
// table mints a short-lived signed *upload* URL and inserts its row
// pointing at that path. The actual gzipped table blob never passes
// through this function — a Vercel serverless function's body limit is far
// smaller than the bucket's 50MB per-file allowance, so the browser uploads
// straight to Storage using the signed URL this returns, via
// supabase-js's `uploadToSignedUrl`.
//
// Optimistic like the original client-side version: a row is inserted as
// soon as its upload URL is minted, before the browser has actually
// uploaded anything. If an upload then fails, the row's storage_path won't
// resolve — an accepted, pre-existing gap (see app.js's own comment on
// this not being atomic), not something this rewrite introduces.

import { getVerifiedUserId } from '../../_supabaseAuth.js';
import { getSupabaseAdmin } from '../../_supabaseAdmin.js';

const DATA_BUCKET = 'dashboard-data';

async function removeAllObjectsUnder(supabase, prefix) {
  const { data } = await supabase.storage.from(DATA_BUCKET).list(prefix, { limit: 1000 });
  const paths = (data || []).map((f) => `${prefix}/${f.name}`);
  if (paths.length) await supabase.storage.from(DATA_BUCKET).remove(paths);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const userId = await getVerifiedUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }
  const { id: dashboardId } = req.query;
  const tables = Array.isArray(req.body?.tables) ? req.body.tables : [];

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(503).json({ error: 'Saved dashboards are not configured on the server yet' });
    return;
  }

  const { data: dashboard } = await supabase
    .from('dashboards')
    .select('id')
    .eq('id', dashboardId)
    .eq('user_id', userId)
    .single();
  if (!dashboard) { res.status(404).json({ error: "Couldn't find that dashboard" }); return; }

  const { error: delErr } = await supabase.from('dashboard_tables').delete().eq('dashboard_id', dashboardId);
  if (delErr) { res.status(500).json({ error: delErr.message }); return; }
  await removeAllObjectsUnder(supabase, `${userId}/${dashboardId}`);

  const results = [];
  for (const t of tables) {
    const path = `${userId}/${dashboardId}/${encodeURIComponent(t.table_name)}.json.gz`;
    const { data: signed, error: signErr } = await supabase.storage.from(DATA_BUCKET).createSignedUploadUrl(path);
    if (signErr) { res.status(500).json({ error: signErr.message }); return; }

    const { error: rowErr } = await supabase.from('dashboard_tables').insert({
      dashboard_id: dashboardId,
      user_id: userId,
      table_name: t.table_name,
      file_name: t.file_name,
      source_type: t.source_type,
      sheet_name: t.sheet_name,
      row_count: t.row_count,
      columns: t.columns || [],
      storage_path: path,
      position: t.position,
    });
    if (rowErr) { res.status(500).json({ error: rowErr.message }); return; }

    results.push({ table_name: t.table_name, path, signedUrl: signed.signedUrl, token: signed.token });
  }

  res.status(200).json({ tables: results });
}
