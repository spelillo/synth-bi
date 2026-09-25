// bridge.js — the contract between the vanilla shell (owns db, tables, auth —
// see state.js) and the React dashboard island mounted at #dashboard-root
// (see /dashboard). The island never touches sql.js or Supabase directly; it
// calls window.synthBridge for everything. Keeping this surface small and
// stable is what lets the island's own build tooling (Vite) stay isolated
// from the shell's script-tag/no-bundler world — see BUILD-INSTRUCTIONS.md
// for the full architecture writeup.
//
// STUB — method bodies to be filled in alongside app.js/chat.js/checkout.js.

window.synthBridge = {
  // ---- Data ----
  runQuery(_sql) {
    // Runs against `db` (state.js), returns { columns, rows } or throws.
  },
  getSchema() {
    // Returns `tables` (state.js) in the shape the AI system prompt / tile
    // editor both expect.
  },
  onSchemaChange(_callback) {
    // Subscribe: fires whenever a file is uploaded or a table is added/removed.
  },

  // ---- Dashboard tiles ----
  getTiles() {
    return dashboardTiles;
  },
  setTiles(_next) {
    // Updates `dashboardTiles` and persists to Supabase if signed in
    // (mirrors saveCurrentSession()'s pattern in synth-sql's app.js).
  },

  // ---- Auth / access ----
  getCurrentUser() {
    return currentUser;
  },
  canExport() {
    // Export requires sign-in regardless of Lite/Normal Mode — initial-build.md §7.
    return !!currentUser;
  },
  requireSignIn(_reason) {
    // Opens the account modal — same gesture as checkout.js's requireFeature().
  },

  // ---- AI ----
  getAiMode() {
    return aiMode; // 'ask' | 'agent'
  },
  setAiMode(_mode) {},
  sendAiMessage(_message) {
    // Proxies to chat.js's existing Groq call pattern (schema-only context).
  },

  // ---- Export ----
  exportToExcel(_tileIds) {
    // Per-table .xlsx via Pyodide + XlsxWriter — see excel_chart.py.
  },
  exportToTableau(_tileIds) {
    // Generates a .tds (Tableau Data Source XML) — see dashboard/src/lib/tdsExport.js.
  },
};
