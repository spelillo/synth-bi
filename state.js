// state.js — every top-level mutable global shared across the split-out
// shell files (db, tables, currentUser, dashboard tiles, etc.), declared
// exactly once. Same runtime model as synth-sql: no modules, no bundler for
// the shell — plain globals, this file's <script> tag loads first. The
// dashboard/ React island never reads or writes these directly; it goes
// through window.synthBridge (see bridge.js) instead.

let db;                 // sql.js database — every uploaded file becomes a table here
let SQL;                // sql.js module handle

let currentUser = null;
let aiEnabled = false;  // Ask/Agent mode only usable in Normal Mode (signed in) — initial-build.md §7
let aiMode = 'ask';     // 'ask' | 'agent' — initial-build.md §6

let dataLoaded = false;

// ---- Multi-table workspace state (ported from synth-sql) ----
let tables = [];              // [{ name, fileName, sourceType: 'csv'|'json'|'xlsx', sheetName, rowCount, columns }]
let activeTableName = null;

// ---- Dashboard state (new) ----
// One entry per tile on the canvas. This array *is* the workspace's
// dashboard — the React island renders from it via bridge.js and never owns
// a second copy of it. Each tile is independently re-runnable against `db`.
let dashboardTiles = [];      // [{ id, sql, chartSpec, position: { x, y, w, h } }]
let previewMode = 'synth';    // 'synth' | 'powerbi' | 'tableau' — initial-build.md §8a

let currentWorkspaceId = null;
let currentWorkspaceName = null;
let chatHistory = [];

// Row cap applies flat, regardless of Lite/Normal Mode — initial-build.md §5.
const MAX_ROWS_PER_TABLE = 500_000;
