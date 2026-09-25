// api/chat.js — ported from synth-sql as-is: Vercel serverless function
// proxying chat requests to Groq. Requires a verified signed-in session
// (getVerifiedUserId) and enforces the same per-account rate limit
// (_aiRateLimit.js) before forwarding. GROQ_API_KEY never reaches the
// browser. See synth-sql/api/chat.js for the reference implementation —
// this only needs pointing at synth-bi's own Supabase project.

// STUB
export default async function handler(_req, _res) {}
