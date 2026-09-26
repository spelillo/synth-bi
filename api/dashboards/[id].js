// api/dashboards/[id].js — GET loads one dashboard plus its tables (with a
// short-lived signed download URL per table, so the browser fetches the
// gzipped table data straight from Storage instead of through this
// function's response body). PATCH updates the dashboard's saved fields
// (autosave, rename). DELETE removes the dashboard row and its Storage
// objects. Every query filters on user_id = the verified caller, not just
// on id, so one account can never touch another's row even by guessing an
// id — the service role bypasses RLS, so this file is what enforces
// ownership instead.

import { getVerifiedUserId } from '../_supabaseAuth.js';
import { getSupabaseAdmin } from '../_supabaseAdmin.js';

const DATA_BUCKET = 'dashboard-data';
const SIGNED_URL_TTL_SECONDS = 120;
const WRITABLE_FIELDS = ['name', 'tiles', 'settings', 'relationships', 'chat_history', 'thumbnail'];

function pickWritable(body) {
  const out = {};
  for (const key of WRITABLE_FIELDS) if (body && body[key] !== undefined) out[key] = body[key];
  return out;
}

async function removeAllObjectsUnder(supabase, prefix) {
  const { data } = await supabase.storage.from(DATA_BUCKET).list(prefix, { limit: 1000 });
  const paths = (data || []).map((f) => `${prefix}/${f.name}`);
  if (paths.length) await supabase.storage.from(DATA_BUCKET).remove(paths);
}

export default async function handler(req, res) {
  const userId = await getVerifiedUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }
  const { id } = req.query;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(503).json({ error: 'Saved dashboards are not configured on the server yet' });
    return;
  }

  if (req.method === 'GET') {
    const { data: dashboard, error } = await supabase
      .from('dashboards')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    if (error || !dashboard) { res.status(404).json({ error: "Couldn't find that dashboard" }); return; }

    const { data: tableRows, error: tErr } = await supabase
      .from('dashboard_tables')
      .select('*')
      .eq('dashboard_id', id)
      .order('position');
    if (tErr) { res.status(500).json({ error: tErr.message }); return; }

    const tables = [];
    for (const t of tableRows || []) {
      const { data: signed, error: signErr } = await supabase.storage
        .from(DATA_BUCKET)
        .createSignedUrl(t.storage_path, SIGNED_URL_TTL_SECONDS);
      if (signErr) { res.status(500).json({ error: signErr.message }); return; }
      tables.push({ ...t, signedUrl: signed.signedUrl });
    }

    res.status(200).json({ dashboard, tables });
    return;
  }

  if (req.method === 'PATCH') {
    const payload = pickWritable(req.body);
    const { error } = await supabase.from('dashboards').update(payload).eq('id', id).eq('user_id', userId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  if (req.method === 'DELETE') {
    await removeAllObjectsUnder(supabase, `${userId}/${id}`);
    const { error } = await supabase.from('dashboards').delete().eq('id', id).eq('user_id', userId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
