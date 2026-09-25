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
let aiMode = 'ask';     // 'ask' | 'build' — see chat.js (Build replaced the docs' act-freely Agent Mode)

let dataLoaded = false;

// ---- Multi-table workspace state (ported from synth-sql) ----
// `columns` is the plain list of column names (what synth-sql's
// relationship detection and schema text already expect). `columnInfo` is
// new: a per-column profile computed once at load time — { name, kind:
// 'numeric'|'date'|'text', integer, isoDate } — used by the tile editor's
// Visual mode, the AI system prompt, and the Tableau .tds field types.
let tables = [];              // [{ name, fileName, sourceType: 'csv'|'json'|'xlsx', sheetName, rowCount, columns, columnInfo }]
let activeTableName = null;

// ---- Dashboard state (new) ----
// One entry per tile on the canvas. This array *is* the workspace's
// dashboard — the React island renders from it via bridge.js and never owns
// a second copy of it. Each tile is independently re-runnable against `db`.
//
// chartSpec stores columns by *name*, not index — { type, title, category:
// <name|null>, values: [<name>], xAxisTitle, yAxisTitle } — so a tile keeps
// pointing at the right column even if its SQL is edited to reorder them
// (shared/chart-engine.js resolveChartSpec() maps names back to indexes at
// render time). `source` is optional editor metadata so a Visual-mode tile
// reopens in Visual mode with its fields intact; it never affects rendering.
let dashboardTiles = [];      // [{ id, sql, chartSpec, appearance?, position: { x, y, w, h }, source? }] | text boxes: [{ id, kind: 'text', text, style, position }]
let previewMode = 'synth';    // 'synth' | 'powerbi' | 'tableau' — initial-build.md §8a

// Canvas-level look & layout, saved with the dashboard. layout 'free' is
// slide-like (tiles stay where they're dropped); 'flow' floats tiles up to
// fill gaps. Tile positions are in a 24-column grid.
let dashboardSettings = { background: '', layout: 'free', spacing: 'comfortable', corners: 'rounded' };

let currentWorkspaceId = null;
let currentWorkspaceName = null;
let chatHistory = [];

// Row cap applies flat, regardless of Lite/Normal Mode — initial-build.md §5.
const MAX_ROWS_PER_TABLE = 500_000;
const MAX_TABLES_PER_WORKSPACE = 10;
