// chat.js — ported from synth-sql's chat.js pattern: schema-only system
// prompt (never row values), Groq via /api/chat, same rate-limit boundary.
// Two real differences from synth-sql:
//
// 1. Ask/Agent mode toggle (initial-build.md §6) replaces the SQL/General
//    mode toggle. Ask Mode keeps synth-sql's exact shape (propose a query +
//    chart spec, "Add to dashboard" places it as a tile via
//    window.synthBridge.setTiles()). Agent Mode is new: a tool-calling loop
//    against Groq that can add/edit/remove tiles directly, narrating what it
//    did — v1.1 per initial-build.md §10, not part of the first build.
//
// 2. The system prompt describes every table in the workspace (same
//    multi-table framing synth-sql already uses for cross-table joins), plus
//    a compact summary of the current dashboard's tiles, so follow-up
//    requests like "make the last one a line chart instead" resolve.
//
// STUB — full system-prompt text and sendMessage() to be written alongside
// the dashboard island (they call into each other via bridge.js).
