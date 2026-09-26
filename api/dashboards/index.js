// api/dashboards/index.js — GET lists the signed-in user's dashboards
// (the home page's "Your dashboards" panel), POST creates a new one.
// See api/_supabaseAdmin.js for why this goes through the service role
// instead of a client-side RLS-scoped query.

import { getVerifiedUserId } from '../_supabaseAuth.js';
import { getSupabaseAdmin } from '../_supabaseAdmin.js';

// Only these fields are ever written from a client payload — id, user_id,
// created_at, and updated_at are always server-assigned.
const WRITABLE_FIELDS = ['name', 'tiles', 'settings', 'relationships', 'chat_history', 'thumbnail'];

function pickWritable(body) {
  const out = {};
  for (const key of WRITABLE_FIELDS) if (body && body[key] !== undefined) out[key] = body[key];
  return out;
}

export default async function handler(req, res) {
  const userId = await getVerifiedUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Sign in required' });
    return;
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(503).json({ error: 'Saved dashboards are not configured on the server yet' });
    return;
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('dashboards')
      .select('id, name, tiles, thumbnail, updated_at, dashboard_tables(table_name, row_count)')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ dashboards: data });
    return;
  }

  if (req.method === 'POST') {
    const payload = { ...pickWritable(req.body), user_id: userId };
    const { data, error } = await supabase.from('dashboards').insert(payload).select('id').single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(200).json({ id: data.id });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
