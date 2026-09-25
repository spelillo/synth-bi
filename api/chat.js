// api/chat.js — ported from synth-sql: Vercel serverless function proxying
// chat requests to Groq. Requires a verified signed-in session
// (getVerifiedUserId) and enforces the per-account rate limit
// (_aiRateLimit.js) before forwarding. GROQ_API_KEY never reaches the
// browser.
//
// One hardening change from synth-sql's straight pass-through: only the
// fields the app actually sends are forwarded, the model is pinned to an
// allowlist, and output length is capped — this endpoint spends the site's
// Groq budget, so a signed-in user shouldn't be able to point it at an
// arbitrary model or ask for unbounded completions.

import { getVerifiedUserId } from './_supabaseAuth.js';
import { checkAndRecordAiUsage } from './_aiRateLimit.js';

const ALLOWED_MODELS = new Set(['openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const MAX_COMPLETION_TOKENS = 4096;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 24_000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'Method not allowed' } });
    return;
  }

  const userId = await getVerifiedUserId(req);
  if (!userId) {
    res.status(401).json({ error: { message: 'Sign in required to use the AI assistant' } });
    return;
  }

  const messages = req.body?.messages;
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) {
    res.status(400).json({ error: { message: 'Request body must include a messages array' } });
    return;
  }
  const cleanMessages = [];
  for (const m of messages) {
    if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > MAX_MESSAGE_CHARS) {
      res.status(400).json({ error: { message: 'Invalid message in request' } });
      return;
    }
    cleanMessages.push({ role: m.role, content: m.content });
  }

  const usage = await checkAndRecordAiUsage(userId);
  if (!usage.allowed) {
    res.status(429).json({ error: { message: usage.message } });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: { message: 'GROQ_API_KEY is not configured on the server' } });
    return;
  }

  const body = {
    model: ALLOWED_MODELS.has(req.body.model) ? req.body.model : DEFAULT_MODEL,
    messages: cleanMessages,
    temperature: typeof req.body.temperature === 'number' ? Math.min(1, Math.max(0, req.body.temperature)) : 0.3,
    max_completion_tokens: Math.min(MAX_COMPLETION_TOKENS, Number(req.body.max_completion_tokens) || MAX_COMPLETION_TOKENS),
  };
  if (req.body.response_format && req.body.response_format.type === 'json_object') body.response_format = { type: 'json_object' };

  try {
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    const data = await groqResponse.text();
    res.status(groqResponse.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
}
