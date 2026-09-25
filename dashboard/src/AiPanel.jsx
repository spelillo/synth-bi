// dashboard/src/AiPanel.jsx — the AI assistant panel living alongside the
// dashboard canvas (replaces synth-sql's separate "Query & Chat" tab — see
// initial-build.md §9). Hosts the Ask/Agent mode toggle (§6):
//
//   - Ask Mode (v1): proposes a query + chart spec in chat; "Add to
//     dashboard" calls bridge.js's setTiles() to place it.
//   - Agent Mode (v1.1, not in the first build): acts on the dashboard
//     directly via a Groq tool-calling loop, narrating changes as it makes
//     them (act-freely-with-undo, per §6's decision).
//
// Disabled entirely in Lite Mode (no sign-in) — see bridge.js's
// getCurrentUser()/requireSignIn().
//
// STUB

export default function AiPanel(_props) {
  return null;
}
