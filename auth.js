// auth.js — ported from synth-sql with minimal changes: Supabase auth +
// the account modal. Client-side Supabase URL/publishable key hardcoded
// here (same reasoning as synth-sql — no bundler, this key is meant to be
// public) — points at synth-bi's own Supabase project, not synth-sql's.
//
// Account-pitch copy changes for synth-bi's actual perks: save dashboards
// across devices, AI assistant (Ask + Agent mode), and — the one perk that's
// stricter than synth-sql's — export to Power BI/Tableau requires an account
// even though it isn't an AI feature (initial-build.md §7).

// Project ref fvjlqcrjfbxgqjbbqdaa — see BUILD-INSTRUCTIONS.md §7 for the
// full Supabase setup (CLI link command, what's still needed).
const SUPABASE_URL = 'https://fvjlqcrjfbxgqjbbqdaa.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_KSbBry-RR0L4QnSUT5k8Kg_kLF3PkjX';

// STUB — see BUILD-INSTRUCTIONS.md for the account-modal copy and flow.
// Next: const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
