// api/_aiRateLimit.js — ported from synth-sql. Burst + daily per-account AI
// usage limits. Synth-sql splits the daily limit by is_premium; synth-bi has
// no paid tier (initial-build.md §7), so this collapses to a single flat
// daily limit for every signed-in account rather than a free/premium split.
//
// STUB — port checkAndRecordAiUsage(), drop the is_premium branch.
export async function checkAndRecordAiUsage(_userId) {}
