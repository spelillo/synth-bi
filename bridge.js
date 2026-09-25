// bridge.js — the contract between the vanilla shell (owns db, tables, auth —
// see state.js) and the React dashboard island mounted at #dashboard-root
// (see /dashboard). The island never touches sql.js or Supabase directly; it
// calls window.synthBridge for everything. Keeping this surface small and
// stable is what lets the island's own build tooling (Vite) stay isolated
// from the shell's script-tag/no-bundler world — see BUILD-INSTRUCTIONS.md
// for the full architecture writeup.
//
// Subscriptions (onSchemaChange / onTilesChange / onAuthChange /
// onAiModeChange) are how shell-side changes reach the island: app.js,
// auth.js, and chat.js call the notify*() helpers below after mutating the
// globals they own, and every subscriber — the island today, Agent Mode's
// tool-calling loop in v1.1 — hears about it the same way. Each on*()
// returns an unsubscribe function.

const bridgeListeners = { schema: new Set(), tiles: new Set(), auth: new Set(), aiMode: new Set() };

function emitBridgeEvent(kind, payload) {
  bridgeListeners[kind].forEach(cb => {
    try { cb(payload); } catch (err) { console.error(`synthBridge ${kind} listener failed:`, err); }
  });
}

function subscribeBridge(kind, cb) {
  bridgeListeners[kind].add(cb);
  return () => bridgeListeners[kind].delete(cb);
}

let schemaVersion = 0;

function notifySchemaChange() {
  schemaVersion++;
  emitBridgeEvent('schema', window.synthBridge.getSchema());
}

function notifyTilesChange() {
  emitBridgeEvent('tiles', dashboardTiles);
}

function notifyAuthChange() {
  emitBridgeEvent('auth', currentUser);
}

// ---- Read-only query guard ----
// Tiles re-run their SQL on every render, resize, and workspace load, so a
// tile must never be able to mutate `db` (synth-sql's single query box
// could, because a person pressed Run once, deliberately). This strips
// string literals, quoted identifiers, and comments first so a keyword
// inside a value ('drop shipping') or a function call (REPLACE(x, ',', ''))
// isn't mistaken for a statement.
const WRITE_KEYWORD_RE = /\b(insert|update|delete|drop|alter|create|attach|detach|vacuum|reindex|pragma|analyze|begin|commit|rollback|savepoint|release)\b|\breplace\s+into\b/i;

function stripSqlLiterals(sql) {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/\[[^\]]*\]/g, '[]')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function assertReadOnlyQuery(sql) {
  const bare = stripSqlLiterals(sql).trim().replace(/;\s*$/, '');
  if (!bare) throw new Error('Write a query first.');
  if (bare.includes(';')) throw new Error('Tiles run one query at a time — remove everything after the first semicolon.');
  if (!/^(select|with|values)\b/i.test(bare)) throw new Error('Tiles are read-only — start the query with SELECT (or WITH).');
  const write = bare.match(WRITE_KEYWORD_RE);
  if (write) throw new Error(`Tiles are read-only, so "${write[0].toUpperCase()}" isn't allowed here. Your data is only ever changed by uploading files.`);
}

window.synthBridge = {
  // ---- Data ----
  // Runs against `db` (state.js), returns { columns, rows, truncated } or
  // throws with a message fit to show the user. maxRows bounds what a tile
  // materializes — charts only ever draw the first MAX_POINTS rows anyway.
  runQuery(sql, { maxRows = 5000 } = {}) {
    if (!db || !dataLoaded) throw new Error('Upload a file first.');
    assertReadOnlyQuery(sql);
    let stmt;
    try {
      stmt = db.prepare(sql);
      const columns = stmt.getColumnNames();
      const rows = [];
      let truncated = false;
      while (stmt.step()) {
        if (rows.length >= maxRows) { truncated = true; break; }
        rows.push(stmt.get());
      }
      return { columns, rows, truncated };
    } finally {
      if (stmt) stmt.free();
    }
  },

  // Every table in the workspace, as copies — callers can't mutate shell
  // state through the returned objects.
  getSchema() {
    return tables.map(t => ({
      name: t.name,
      fileName: t.fileName,
      sourceType: t.sourceType,
      sheetName: t.sheetName || null,
      rowCount: t.rowCount,
      columns: (t.columnInfo || t.columns.map(name => ({ name, kind: 'text' }))).map(c => ({ ...c })),
    }));
  },
  getSchemaVersion() {
    return schemaVersion;
  },
  // Confirmed foreign-key relationships (Relationships tab) — join hints for
  // the tile editor and the AI, never enforced constraints.
  getRelationships() {
    return (typeof relationships !== 'undefined' ? relationships : [])
      .filter(r => r.confirmed)
      .map(({ fromTable, fromColumn, toTable, toColumn, cardinality }) => ({ fromTable, fromColumn, toTable, toColumn, cardinality }));
  },
  onSchemaChange(callback) {
    return subscribeBridge('schema', callback);
  },

  // ---- Dashboard tiles ----
  getTiles() {
    return dashboardTiles;
  },
  // Replaces the whole array (the island treats tiles immutably). Marks the
  // workspace unsaved, and — for a workspace already saved to the cloud —
  // schedules a debounced save of the dashboard (app.js).
  setTiles(next) {
    if (!Array.isArray(next)) throw new Error('setTiles expects an array of tiles');
    dashboardTiles = next;
    if (typeof onDashboardTilesChanged === 'function') onDashboardTilesChanged();
    notifyTilesChange();
  },
  onTilesChange(callback) {
    return subscribeBridge('tiles', callback);
  },

  // ---- Preview theme (v1.1 destination preview, §8a) ----
  getPreviewMode() {
    return previewMode;
  },

  // ---- Auth / access ----
  getCurrentUser() {
    return currentUser ? { id: currentUser.id, email: currentUser.email } : null;
  },
  onAuthChange(callback) {
    return subscribeBridge('auth', callback);
  },
  canExport() {
    // Export requires sign-in regardless of Lite/Normal Mode — initial-build.md §7.
    return canUseFeature('export');
  },
  canUseAi() {
    return canUseFeature('ai');
  },
  // Opens the account modal (same gesture as checkout.js's requireFeature())
  // and returns false, or returns true if already signed in.
  requireSignIn(reason) {
    return requireFeature(reason === 'ai' ? 'ai' : 'export');
  },

  // ---- AI ----
  getAiMode() {
    return aiMode; // 'ask' | 'agent'
  },
  setAiMode(mode) {
    if (mode !== 'ask' && mode !== 'agent') return;
    aiMode = mode;
    emitBridgeEvent('aiMode', aiMode);
  },
  onAiModeChange(callback) {
    return subscribeBridge('aiMode', callback);
  },
  // Proxies to chat.js's Groq call (schema-only context). Resolves to
  // { text, proposals: [{ sql, chartSpec }] } in Ask Mode.
  sendAiMessage(message, context) {
    if (typeof sendAskMessage !== 'function') return Promise.reject(new Error('The AI assistant isn\'t available yet.'));
    return sendAskMessage(message, context);
  },
  clearAiSession() {
    chatHistory = [];
  },

  // ---- Export ----
  // Both resolve once the download has been handed to the browser; see
  // app.js exportDashboard() for the bundle layout.
  exportToExcel(tileIds, options) {
    if (typeof exportDashboard !== 'function') return Promise.reject(new Error('Export isn\'t available yet.'));
    return exportDashboard({ tileIds, ...options, target: 'excel' });
  },
  exportToTableau(tileIds, options) {
    if (typeof exportDashboard !== 'function') return Promise.reject(new Error('Export isn\'t available yet.'));
    return exportDashboard({ tileIds, ...options, target: 'tableau' });
  },
};
