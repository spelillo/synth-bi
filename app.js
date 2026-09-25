// app.js — ported from synth-sql's app.js: home view, file upload
// (CSV/JSON/Excel — xlsx-parser.js is the one new input path), workspace
// switching, and everything not owned by a more specific file. Drives
// home-view <-> app-view, same as synth-sql.
//
// The Dashboard tab's canvas itself is NOT here — that's the React island in
// /dashboard, mounted at #dashboard-root. app.js's job for that tab is only
// to keep window.synthBridge (bridge.js) in sync with `tables`/`db` as files
// load (notifySchemaChange / notifyTilesChange), so the island always sees
// current schema.
//
// Not carried over from synth-sql: the single query editor + results pane
// (every tile owns its query now — dashboard/src/TileEditor.jsx), saved
// queries, the premium/enterprise/org flows, and tier caps other than the
// flat per-table row cap (initial-build.md §5, §7).

async function initDB() {
  const SQL = await initSqlJs({
    locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.8.0/dist/${file}`
  });
  return SQL;
}

window.addEventListener('DOMContentLoaded', async () => {
  initHome();
  initTabs();
  if (typeof initAuth === 'function') initAuth();
  try {
    SQL = await initDB();
    setAppStatus('ready');
  } catch (err) {
    console.error('sql.js failed to load:', err);
    setAppStatus('error');
    setHomeUploadMessage("Couldn't load the in-browser database engine. Check your connection and reload.", true);
  }
});

function setAppStatus(state) {
  const el = document.getElementById('status');
  if (!el) return;
  el.dataset.state = state;
  el.textContent = state === 'ready' ? 'Ready' : state === 'error' ? 'Offline' : 'Starting…';
}

// ---- Workspace dirty/synced state ----
// Whether the in-browser workspace (tables + tiles) exactly matches what's
// last saved to the cloud — drives the "Save to cloud" button's status.
let workspaceSynced = false;

function markWorkspaceDirty() {
  workspaceSynced = false;
  updateCloudButtons();
}

function markWorkspaceSynced() {
  workspaceSynced = true;
  updateCloudButtons();
}

function updateCloudButtons() {
  const btn = document.getElementById('save-cloud-btn');
  if (!btn) return;
  btn.hidden = !(currentUser && tables.length > 0);
  if (btn.hidden) return;
  btn.disabled = false;
  btn.classList.toggle('is-synced', workspaceSynced);
  btn.textContent = workspaceSynced ? 'Saved' : 'Save to cloud';
}

// Called by bridge.js setTiles() whenever the island changes the dashboard.
function onDashboardTilesChanged() {
  markWorkspaceDirty();
  if (typeof scheduleDashboardAutosave === 'function') scheduleDashboardAutosave();
}

// ---- Home view: upload drop zone + saved dashboards ----

const UPLOAD_EXTENSIONS = /\.(csv|json|ndjson|jsonl|xlsx|xlsm)$/i;
const UPLOAD_EXTENSIONS_LABEL = '.csv, .json, .ndjson, .jsonl, and .xlsx';

function initHome() {
  setActiveView('home');
  if (typeof renderHomeDashboards === 'function') renderHomeDashboards();

  const home = document.getElementById('home-view');
  const zone = document.getElementById('home-dropzone');
  let dragDepth = 0;

  document.getElementById('home-dropzone-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openFilePicker();
  });
  zone.addEventListener('click', openFilePicker);
  zone.addEventListener('keydown', (e) => {
    if (e.target !== zone) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFilePicker(); }
  });

  // The whole home view accepts drops (not just the zone), so a file
  // released a few pixels off-target still uploads instead of the
  // browser navigating away to open it.
  home.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    zone.classList.add('is-dragover');
  });
  home.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  home.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) zone.classList.remove('is-dragover');
  });
  home.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    dragDepth = 0;
    zone.classList.remove('is-dragover');
    uploadFromHome(Array.from(e.dataTransfer.files));
  });

  // ?auth=signin|signup opens the account modal on load (linked from
  // /welcome's header). Deferred until the session check settles: a
  // returning signed-in visitor shouldn't get a sign-in prompt.
  const params = new URLSearchParams(window.location.search);
  const authParam = params.get('auth');
  if (authParam === 'signin' || authParam === 'signup') {
    params.delete('auth');
    const clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
    window.history.replaceState({}, '', clean);
    setTimeout(() => { if (!currentUser && typeof openAccountModal === 'function') openAccountModal(authParam); }, 400);
  }
}

function uploadFromHome(files) {
  const accepted = files.filter(f => UPLOAD_EXTENSIONS.test(f.name));
  if (!accepted.length) {
    setHomeUploadMessage(`Synth-BI reads ${UPLOAD_EXTENSIONS_LABEL} files.`, true);
    return;
  }
  setHomeUploadMessage('');
  window.uploadFiles({ target: { files: accepted } });
}

function setHomeUploadMessage(text, isError) {
  const el = document.getElementById('home-upload-message');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

window.openFilePicker = function() {
  const input = document.getElementById('file-upload');
  // Cleared first so picking the same file again (after heading back
  // home) still fires a change event.
  input.value = '';
  setHomeUploadMessage('');
  input.click();
};

window.openAddTablePicker = function() {
  const input = document.getElementById('file-upload-add');
  input.value = '';
  input.click();
};

// Exactly one of home-view / app-view is visible.
function setActiveView(view) {
  const onHome = view === 'home';
  document.getElementById('home-view').hidden = !onHome;
  document.getElementById('app-view').hidden = onHome;
  document.getElementById('header-dashboards-btn').hidden = onHome;
  document.getElementById('home-return-btn').hidden = !(onHome && hasLoadedWorkspace());
  document.body.classList.toggle('in-app', !onHome);
}

function hasLoadedWorkspace() {
  return dataLoaded && tables.length > 0;
}

window.openHome = function() {
  setActiveView('home');
  if (typeof renderHomeDashboards === 'function') renderHomeDashboards();
};

window.returnToWorkspace = function() {
  if (!hasLoadedWorkspace()) return;
  setActiveView('app');
  renderTableChips();
};

// ---- Tabs: Dashboard / Table View / Relationships ----

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => selectTab(btn.dataset.tab));
  });
  document.getElementById('table-search').addEventListener('input', (e) => tableSearch(e.target.value));
}

function selectTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  if (tab === 'relationships') requestAnimationFrame(renderERD);
  if (tab === 'table') renderTableView();
}

// ---- Column profiling ----
// Every column is stored as TEXT (see loadFileAsTable), so "what kind of
// column is this" is inferred once, at load time, from a sample of its
// values. Stricter than the chart engine's per-result analysis on
// purpose: a column only counts as numeric if *every* sampled value is a
// plain number SQLite's CAST reads correctly, since the Visual tile
// builder and the Tableau .tds both act on this label directly.
const PROFILE_NUMBER_RE = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;
const PROFILE_ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const PROFILE_LOOSE_DATE_RE = /^(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}\/\d{1,2}(\/\d{1,2})?|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4})$/i;

function profileColumns(headers, rows) {
  const sample = rows.length > 5000 ? rows.slice(0, 5000) : rows;
  return headers.map((name, c) => {
    let nonEmpty = 0, numeric = 0, integer = 0, leadingZero = 0, iso = 0, isoDateOnly = 0, loose = 0;
    for (const row of sample) {
      const v = row[c];
      if (v === null || v === undefined || v === '') continue;
      nonEmpty++;
      const s = String(v);
      if (PROFILE_NUMBER_RE.test(s)) {
        numeric++;
        if (!/[.eE]/.test(s)) integer++;
        if (/^-?0\d/.test(s)) leadingZero++;
      } else if (PROFILE_ISO_DATE_RE.test(s)) {
        iso++;
        if (s.length === 10) isoDateOnly++;
      } else if (PROFILE_LOOSE_DATE_RE.test(s)) {
        loose++;
      }
    }
    let kind = 'text';
    if (nonEmpty > 0 && numeric === nonEmpty && leadingZero === 0) kind = 'numeric';
    else if (nonEmpty > 0 && iso === nonEmpty) kind = 'date';
    else if (nonEmpty > 0 && iso + loose >= 0.9 * nonEmpty) kind = 'date';
    return {
      name,
      kind,
      integer: kind === 'numeric' && integer === numeric,
      isoDate: kind === 'date' && iso === nonEmpty,
      dateOnly: kind === 'date' && iso === nonEmpty && isoDateOnly === iso,
    };
  });
}

// Duplicate or blank headers would fail CREATE TABLE ("duplicate column
// name") — synth-sql let that error surface raw; here it's fixed up.
function uniqueHeaders(headers) {
  const used = new Set();
  return headers.map((h, i) => {
    const base = h || `column_${i + 1}`;
    let name = base, n = 2;
    while (used.has(name.toLowerCase())) name = `${base}_${n++}`;
    used.add(name.toLowerCase());
    return name;
  });
}

// Loads one parsed table into the shared `db` and returns its metadata.
// Assumes `db` already exists — callers create it first. The insert loop
// is wrapped in one transaction and yields between chunks.
async function loadFileAsTable({ fileName, sourceType, sheetName = null }, rawHeaders, rows, proposedName) {
  const name = uniqueTableName(proposedName);
  const headers = uniqueHeaders(rawHeaders);

  const columnDefs = headers.map(h => `"${h.replace(/"/g, '""')}" TEXT`).join(', ');
  db.run(`CREATE TABLE "${name}" (${columnDefs})`);

  db.run('BEGIN TRANSACTION');
  const stmt = db.prepare(`INSERT INTO "${name}" VALUES (${headers.map(() => '?').join(', ')})`);
  for (let start = 0; start < rows.length; start += CSV_CHUNK_SIZE) {
    const end = Math.min(start + CSV_CHUNK_SIZE, rows.length);
    for (let i = start; i < end; i++) {
      const row = rows[i];
      if (row.length === headers.length) {
        stmt.run(row);
      } else if (row.length < headers.length) {
        stmt.run([...row, ...Array(headers.length - row.length).fill('')]);
      } else {
        stmt.run(row.slice(0, headers.length));
      }
    }
    advanceLoadProgress(end - start);
    if (end < rows.length) await yieldToUI();
  }
  stmt.free();
  db.run('COMMIT');

  const meta = {
    name,
    fileName,
    sourceType,
    sheetName,
    rowCount: rows.length,
    columns: headers,
    columnInfo: profileColumns(headers, rows),
  };
  tables.push(meta);
  return meta;
}

function assertRowCapOrThrow(rowCount, label) {
  if (rowCount <= MAX_ROWS_PER_TABLE) return;
  throw new Error(`${label} has ${rowCount.toLocaleString()} rows, over the ${MAX_ROWS_PER_TABLE.toLocaleString()}-row limit per table (a browser-performance limit, the same for every account).`);
}

// Single entry point for every format: returns one or more parsed tables
// per file (an Excel workbook yields one per non-empty sheet).
async function parseUploadedFile(file, text) {
  if (isXLSXFile(file.name)) {
    const sheets = await parseXLSX(file);
    return sheets.map(s => ({
      source: { fileName: file.name, sourceType: 'xlsx', sheetName: s.sheetName },
      label: `Sheet "${s.sheetName}" in ${file.name}`,
      headers: s.headers,
      rows: s.rows,
      proposedName: xlsxTableName(file.name, s.sheetName, sheets.length),
    }));
  }
  const json = isJSONFile(file.name);
  // Excel's "CSV UTF-8" export starts with a byte-order mark, which would
  // otherwise end up baked into the first column's name.
  text = text.replace(/^﻿/, '');
  const { headers, rows } = json ? await parseJSONText(text) : await parseCSVText(text);
  return [{
    source: { fileName: file.name, sourceType: json ? 'json' : 'csv' },
    label: file.name,
    headers,
    rows,
    proposedName: slugifyTableName(file.name),
  }];
}

// ---- Upload flow: parse file(s) -> loading transition -> reveal the app ----
// Starts a brand-new workspace, replacing anything currently loaded
// (including the dashboard's tiles).

window.uploadFiles = async function(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;
  if (!SQL) {
    setHomeUploadMessage('Still starting up — try again in a second.', true);
    return;
  }

  showLoadingOverlay();

  try {
    const fileTexts = await sizeLoadProgress(files);
    const parsed = [];
    for (const file of files) {
      for (const t of await parseUploadedFile(file, fileTexts.get(file))) {
        assertRowCapOrThrow(t.rows.length, t.label);
        parsed.push(t);
      }
    }

    db = new SQL.Database();
    tables = [];
    activeTableName = null;
    columnStatsCache = null;

    const toLoad = parsed.slice(0, MAX_TABLES_PER_WORKSPACE);
    const loaded = [];
    for (const t of toLoad) {
      loaded.push(await loadFileAsTable(t.source, t.headers, t.rows, t.proposedName));
    }

    activeTableName = loaded[0].name;
    dataLoaded = true;
    currentWorkspaceId = null;
    currentWorkspaceName = null;
    chatHistory = [];
    dashboardTiles = [];
    rejectedRelationshipKeys = new Set();
    relationships = [];

    setFileInfo(loaded.length === 1
      ? `${loaded[0].fileName} (${formatFileSize(files[0])}, ${loaded[0].rowCount.toLocaleString()} rows) → table "${loaded[0].name}"`
      : `${loaded.length} tables loaded`
        + (parsed.length > toLoad.length ? ` — ${parsed.length - toLoad.length} skipped (a workspace holds up to ${MAX_TABLES_PER_WORKSPACE} tables)` : ''));

    afterWorkspaceTablesChanged();
    notifyTilesChange();
    markWorkspaceDirty();

    completeLoadProgress(() => {
      revealApp();
      selectTab('dashboard');
    });
  } catch (err) {
    hideLoadingOverlay();
    console.error(err);
    if (document.getElementById('app-view').hidden) {
      setHomeUploadMessage(err.message, true);
    } else {
      setFileInfo(`Error: ${err.message}`, true);
    }
  }
};

// Adds one or more tables to the *current* workspace, without disturbing
// tables (or tiles) already loaded.
window.addTables = async function(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;
  if (!db || !dataLoaded) return window.uploadFiles(event);

  const room = MAX_TABLES_PER_WORKSPACE - tables.length;
  if (room <= 0) {
    setFileInfo(`This workspace already has ${MAX_TABLES_PER_WORKSPACE} tables, the maximum per workspace.`, true);
    return;
  }

  showLoadingOverlay();
  try {
    const fileTexts = await sizeLoadProgress(files);
    const parsed = [];
    for (const file of files) {
      for (const t of await parseUploadedFile(file, fileTexts.get(file))) {
        assertRowCapOrThrow(t.rows.length, t.label);
        parsed.push(t);
      }
    }

    const loaded = [];
    for (const t of parsed.slice(0, room)) {
      loaded.push(await loadFileAsTable(t.source, t.headers, t.rows, t.proposedName));
    }

    setFileInfo(parsed.length > room
      ? `Added ${loaded.map(t => t.name).join(', ')} — ${parsed.length - room} skipped (a workspace holds up to ${MAX_TABLES_PER_WORKSPACE} tables)`
      : `Added ${loaded.map(t => t.name).join(', ')}`);

    activeTableName = loaded[loaded.length - 1].name;
    afterWorkspaceTablesChanged();
    markWorkspaceDirty();
    completeLoadProgress();
  } catch (err) {
    hideLoadingOverlay();
    setFileInfo(`Error: ${err.message}`, true);
    console.error(err);
  }
};

// Everything that has to re-sync after the set of tables changes.
function afterWorkspaceTablesChanged() {
  renderTableChips();
  recomputeRelationships();
  populateManualFkTableSelects();
  renderTableView();
  notifySchemaChange();
}

function setFileInfo(text, isError) {
  const el = document.getElementById('file-info');
  el.textContent = text;
  el.classList.toggle('error', !!isError);
}

// ---- Table chip bar ----

function getWorkspaceDisplayName() {
  return currentWorkspaceName || (tables[0] && tables[0].fileName) || 'Untitled dashboard';
}

function renderTableChips() {
  const bar = document.getElementById('table-chip-bar');
  document.getElementById('workspace-name').textContent = getWorkspaceDisplayName();

  if (!tables.length) {
    bar.innerHTML = '';
    return;
  }

  document.getElementById('add-table-btn').hidden = tables.length >= MAX_TABLES_PER_WORKSPACE;
  bar.innerHTML = tables.map(t => `
    <div class="table-chip${t.name === activeTableName ? ' active' : ''}" data-table="${escapeAttr(t.name)}" role="button" aria-pressed="${t.name === activeTableName}" aria-label="Table: ${escapeAttr(t.name)}" tabindex="0" onclick="handleChipClick(event, '${t.name}')" onkeydown="handleChipKeydown(event, '${t.name}')">
      <i class="ph ${t.sourceType === 'xlsx' ? 'ph-microsoft-excel-logo' : t.sourceType === 'json' ? 'ph-brackets-curly' : 'ph-file-csv'} chip-icon" aria-hidden="true"></i>
      <span class="chip-name" data-table="${escapeAttr(t.name)}">${escapeHtml(t.name)}</span>
      <span class="chip-rows">${t.rowCount.toLocaleString()}</span>
      <button class="chip-action chip-rename" title="Rename table" aria-label="Rename ${escapeAttr(t.name)}" onclick="startRenameChip(event, '${t.name}')"><i class="ph ph-pencil-simple" aria-hidden="true"></i></button>
      ${tables.length > 1 ? `<button class="chip-action chip-delete" title="Delete table" aria-label="Delete ${escapeAttr(t.name)}" onclick="requestDeleteTable(event, '${t.name}')"><i class="ph ph-x" aria-hidden="true"></i></button>` : ''}
    </div>
  `).join('');
}

window.handleChipClick = function(event, name) {
  if (event.target.closest('.chip-action') || event.target.isContentEditable) return;
  setActiveTable(name);
};

// The chip itself is a div (role="button"), not a real <button>, since
// it contains its own nested rename/delete buttons.
window.handleChipKeydown = function(event, name) {
  if (event.target !== event.currentTarget) return;
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  setActiveTable(name);
};

window.setActiveTable = function(name) {
  if (!tables.some(t => t.name === name)) return;
  activeTableName = name;
  renderTableChips();
  renderTableView();
  const tableTab = document.getElementById('tab-table');
  if (!tableTab.classList.contains('active')) selectTab('table');
};

window.startRenameChip = function(event, name) {
  event.stopPropagation();
  const bar = document.getElementById('table-chip-bar');
  const label = bar.querySelector(`.chip-name[data-table="${CSS.escape(name)}"]`);
  if (!label) return;

  label.contentEditable = 'true';
  label.focus();
  document.execCommand('selectAll', false, null);

  const commit = () => {
    label.removeAttribute('contenteditable');
    const proposed = slugifyTableName((label.textContent.trim() || name) + '.x');
    renameTable(name, proposed);
  };

  label.addEventListener('blur', commit, { once: true });
  label.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
    if (e.key === 'Escape') { label.textContent = name; label.blur(); }
  });
};

// Table references inside tile SQL: FROM/JOIN targets and table-qualified
// column refs (orders.amount), bare or double-quoted. Deliberately not
// "every occurrence of the word" — a column can share its table's name
// (sales.sales), and string literals (WHERE status = 'orders') are skipped
// entirely by splitting them out first.
function tableRefPatterns(name) {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    new RegExp(`(\\b(?:from|join)\\s+)("?)${n}\\2(?![A-Za-z0-9_])`, 'gi'),
    new RegExp(`(^|[^A-Za-z0-9_."])("?)${n}\\2(?=\\s*\\.)`, 'gi'),
  ];
}

function mapSqlOutsideStrings(sql, fn) {
  return sql.split(/('(?:[^']|'')*')/).map((part, i) => (i % 2 === 1 ? part : fn(part))).join('');
}

function renameTableInSql(sql, oldName, newName) {
  return mapSqlOutsideStrings(sql, part => tableRefPatterns(oldName).reduce(
    (acc, re) => acc.replace(re, (m, pre, quote) => `${pre}${quote}${newName}${quote}`),
    part,
  ));
}

function sqlReferencesTable(sql, name) {
  let found = false;
  mapSqlOutsideStrings(sql, part => {
    if (tableRefPatterns(name).some(re => re.test(part))) found = true;
    return part;
  });
  return found;
}

function renameTable(oldName, proposedName) {
  if (proposedName === oldName) { renderTableChips(); return; }

  const collision = tables.some(t => t.name === proposedName && t.name !== oldName);
  const finalName = collision ? uniqueTableName(proposedName) : proposedName;

  db.run(`ALTER TABLE "${oldName}" RENAME TO "${finalName}"`);
  const entry = tables.find(t => t.name === oldName);
  entry.name = finalName;
  if (activeTableName === oldName) activeTableName = finalName;

  // Existing relationships (including confirmed ones) reference tables by
  // name — follow the rename so a confirmed FK doesn't silently vanish.
  relationships.forEach(r => {
    if (r.fromTable === oldName) r.fromTable = finalName;
    if (r.toTable === oldName) r.toTable = finalName;
  });
  rejectedRelationshipKeys = new Set(
    [...rejectedRelationshipKeys].map(k => k.split('|').map(part => part.startsWith(oldName + '.') ? finalName + part.slice(oldName.length) : part).join('|'))
  );

  // Tiles reference tables by name too, inside their SQL.
  if (dashboardTiles.length) {
    dashboardTiles = dashboardTiles.map(tile => ({
      ...tile,
      sql: renameTableInSql(tile.sql, oldName, finalName),
      source: tile.source && tile.source.visual && tile.source.visual.table === oldName
        ? { ...tile.source, visual: { ...tile.source.visual, table: finalName } }
        : tile.source,
    }));
    notifyTilesChange();
  }

  if (collision) setFileInfo(`"${proposedName}" was already taken, renamed to "${finalName}"`);

  renderTableChips();
  recomputeRelationships();
  populateManualFkTableSelects();
  notifySchemaChange();
  markWorkspaceDirty();
}

// ---- Delete table (chip's X button) ----
// Only shown when there's more than one table (see renderTableChips), so
// there's always at least one table left after a delete.

let tablePendingDelete = null;

function tilesUsingTable(name) {
  return dashboardTiles.filter(t => sqlReferencesTable(t.sql, name));
}

window.requestDeleteTable = function(event, name) {
  event.stopPropagation();
  tablePendingDelete = name;
  document.getElementById('delete-table-name').textContent = `"${name}"`;
  const using = tilesUsingTable(name).length;
  document.getElementById('delete-table-body').textContent = using
    ? `${using} tile${using === 1 ? ' uses' : 's use'} this table and will show an error until you edit or remove ${using === 1 ? 'it' : 'them'}. This can't be undone.`
    : "This can't be undone.";
  document.getElementById('delete-table-modal').hidden = false;
};

window.closeDeleteTableModal = function() {
  tablePendingDelete = null;
  document.getElementById('delete-table-modal').hidden = true;
};

window.confirmDeleteTableSubmit = function() {
  const name = tablePendingDelete;
  tablePendingDelete = null;
  document.getElementById('delete-table-modal').hidden = true;
  if (!name || !tables.some(t => t.name === name)) return;

  db.run(`DROP TABLE "${name}"`);
  tables = tables.filter(t => t.name !== name);
  if (columnStatsCache && columnStatsCache.tableName === name) columnStatsCache = null;
  relationships = relationships.filter(r => r.fromTable !== name && r.toTable !== name);
  if (activeTableName === name) activeTableName = tables.length ? tables[0].name : null;

  afterWorkspaceTablesChanged();
  notifyTilesChange(); // tiles re-run and surface the missing table
  markWorkspaceDirty();
};

// ---- Heuristic foreign-key matching + ERD (Relationships tab) ----
// Relationships are metadata only: they inform the AI's system prompt
// and the ERD view, and are never created as real SQLite FOREIGN KEY
// constraints, since real-world CSVs commonly have orphaned rows that
// would break constraint enforcement on import.

let relationships = [];              // [{ id, fromTable, fromColumn, toTable, toColumn, confirmed, manual, cardinality }]
                                      // cardinality: '1:1' | '1:M' | 'M:M' | '1:0' | '0:M' | null (unset until confirmed)
let rejectedRelationshipKeys = new Set();

function relationshipKey(r) {
  return `${r.fromTable}.${r.fromColumn}|${r.toTable}.${r.toColumn}`;
}

function singularize(name) {
  if (/ies$/i.test(name)) return name.slice(0, -3) + 'y';
  if (/ses$/i.test(name)) return name.slice(0, -2);
  if (/s$/i.test(name) && !/ss$/i.test(name)) return name.slice(0, -1);
  return name;
}

// Suggests A.foo_id -> B.id whenever "foo" matches B's name (singular or
// literal) and B actually has an "id" column. A narrow, explainable rule
// rather than a fuzzy matcher — misses things like a self-referential
// "manager_id" that doesn't name its own table, which is exactly what
// the manual-add control is for.
function inferRelationships() {
  const suggestions = [];
  for (const a of tables) {
    for (const colA of a.columns) {
      if (!/_id$/i.test(colA)) continue;
      const base = colA.slice(0, -3).toLowerCase();
      for (const b of tables) {
        const matches = base === singularize(b.name).toLowerCase() || base === b.name.toLowerCase();
        if (!matches) continue;
        const toCol = b.columns.find(c => c.toLowerCase() === 'id');
        if (!toCol) continue;
        if (a.name === b.name && colA === toCol) continue;
        suggestions.push({ fromTable: a.name, fromColumn: colA, toTable: b.name, toColumn: toCol });
      }
    }
  }
  return suggestions;
}

// Re-derives suggestions after any schema change, preserving confirmed/
// manual relationships and not resurrecting rejected suggestions.
function recomputeRelationships() {
  const suggested = inferRelationships();
  const existingByKey = new Map(relationships.map(r => [relationshipKey(r), r]));
  const next = [];

  suggested.forEach(s => {
    const k = relationshipKey(s);
    if (rejectedRelationshipKeys.has(k)) return;
    const existing = existingByKey.get(k);
    if (existing) {
      next.push(existing);
      existingByKey.delete(k);
    } else {
      next.push({ id: k, ...s, confirmed: false, manual: false });
    }
  });

  existingByKey.forEach(r => {
    if (!(r.confirmed || r.manual)) return;
    const fromOk = tables.some(t => t.name === r.fromTable && t.columns.includes(r.fromColumn));
    const toOk = tables.some(t => t.name === r.toTable && t.columns.includes(r.toColumn));
    if (fromOk && toOk) next.push(r);
  });

  relationships = next;
  renderRelationshipsTabVisibility();
  renderERD();
  renderRelationshipList();
}

function renderRelationshipsTabVisibility() {
  const btn = document.getElementById('relationships-tab-btn');
  btn.hidden = tables.length < 2;
  if (btn.hidden && btn.classList.contains('active')) selectTab('dashboard');
}

function relationshipsChanged() {
  renderERD();
  renderRelationshipList();
  markWorkspaceDirty();
  notifySchemaChange();
}

window.confirmRelationship = function(id) {
  const r = relationships.find(x => x.id === id);
  if (!r) return;
  openRelationshipTypeModal(r.fromTable, r.fromColumn, r.toTable, r.toColumn, r.id);
};

window.rejectRelationship = function(id) {
  const r = relationships.find(x => x.id === id);
  if (!r) return;
  rejectedRelationshipKeys.add(relationshipKey(r));
  relationships = relationships.filter(x => x.id !== id);
  relationshipsChanged();
};

window.removeRelationship = function(id) {
  const r = relationships.find(x => x.id === id);
  if (!r) return;
  if (!r.manual) rejectedRelationshipKeys.add(relationshipKey(r));
  relationships = relationships.filter(x => x.id !== id);
  relationshipsChanged();
};

window.addManualRelationship = function() {
  const fromTable = document.getElementById('manual-fk-from-table').value;
  const fromColumn = document.getElementById('manual-fk-from-col').value;
  const toTable = document.getElementById('manual-fk-to-table').value;
  const toColumn = document.getElementById('manual-fk-to-col').value;
  if (!fromTable || !fromColumn || !toTable || !toColumn) return;
  openRelationshipTypeModal(fromTable, fromColumn, toTable, toColumn, null);
};

// ---- Relationship type popup ----
// Shared by three entry points: dragging column -> column on the
// diagram, confirming an auto-suggested relationship, and the manual
// dropdown form. Picking a type commits immediately.

let pendingRelationshipDraft = null; // { fromTable, fromColumn, toTable, toColumn, existingId }

function openRelationshipTypeModal(fromTable, fromColumn, toTable, toColumn, existingId) {
  pendingRelationshipDraft = { fromTable, fromColumn, toTable, toColumn, existingId };
  document.getElementById('relationship-type-path').textContent =
    `${fromTable}.${fromColumn} → ${toTable}.${toColumn}`;
  document.getElementById('relationship-type-modal').hidden = false;
}

window.closeRelationshipTypeModal = function() {
  document.getElementById('relationship-type-modal').hidden = true;
  pendingRelationshipDraft = null;
};

window.chooseRelationshipType = function(cardinality) {
  if (!pendingRelationshipDraft) return;
  const { fromTable, fromColumn, toTable, toColumn, existingId } = pendingRelationshipDraft;

  if (existingId) {
    const existing = relationships.find(x => x.id === existingId);
    if (existing) {
      existing.confirmed = true;
      existing.cardinality = cardinality;
    }
  } else {
    const r = { fromTable, fromColumn, toTable, toColumn };
    const k = relationshipKey(r);
    rejectedRelationshipKeys.delete(k);
    const idx = relationships.findIndex(x => relationshipKey(x) === k);
    if (idx >= 0) {
      relationships[idx].confirmed = true;
      relationships[idx].manual = true;
      relationships[idx].cardinality = cardinality;
    } else {
      relationships.push({ id: k, ...r, confirmed: true, manual: true, cardinality });
    }
  }

  document.getElementById('relationship-type-modal').hidden = true;
  pendingRelationshipDraft = null;
  relationshipsChanged();
};

// ---- Drag-to-connect: mousedown on a column row, drag to another,
// release to open the type popup. Plain mouse events, no drag library.

let dragState = null; // { fromTable, fromColumn, canvas, colId }

window.startRelationshipDrag = function(event) {
  event.preventDefault();
  const sourceEl = event.currentTarget;
  const fromTable = sourceEl.dataset.table;
  const fromColumn = sourceEl.dataset.column;
  const canvas = document.getElementById('erd-canvas');
  const colId = (table, col) => `erd-col-${cssEscapeId(table)}-${cssEscapeId(col)}`;
  if (!canvas || !sourceEl) return;

  dragState = { fromTable, fromColumn, canvas, colId };
  sourceEl.classList.add('drag-source');

  document.addEventListener('mousemove', onRelationshipDragMove);
  document.addEventListener('mouseup', onRelationshipDragEnd);
};

function hoveredColRow(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest('.erd-col-row') : null;
}

function onRelationshipDragMove(event) {
  if (!dragState) return;
  updateDragLine(event.clientX, event.clientY);

  const hovered = hoveredColRow(event.clientX, event.clientY);
  document.querySelectorAll('.erd-col-row.drag-hover-target').forEach(el => {
    if (el !== hovered) el.classList.remove('drag-hover-target');
  });
  if (hovered && !hovered.classList.contains('drag-source')) {
    hovered.classList.add('drag-hover-target');
  }
}

function onRelationshipDragEnd(event) {
  if (!dragState) return;
  const { fromTable, fromColumn, canvas, colId } = dragState;

  document.removeEventListener('mousemove', onRelationshipDragMove);
  document.removeEventListener('mouseup', onRelationshipDragEnd);
  document.getElementById(colId(fromTable, fromColumn))?.classList.remove('drag-source');
  document.querySelectorAll('.erd-col-row.drag-hover-target').forEach(el => el.classList.remove('drag-hover-target'));
  clearDragLine(canvas);
  dragState = null;

  const target = hoveredColRow(event.clientX, event.clientY);
  if (!target) return;
  const toTable = target.closest('.erd-table-box')?.dataset.table;
  const toColumn = target.dataset.column;
  if (!toTable || !toColumn) return;
  if (toTable === fromTable && toColumn === fromColumn) return; // dropped on itself

  openRelationshipTypeModal(fromTable, fromColumn, toTable, toColumn, null);
}

function updateDragLine(clientX, clientY) {
  if (!dragState) return;
  const { fromTable, fromColumn, canvas, colId } = dragState;
  const svg = canvas.querySelector('.erd-svg-overlay');
  const sourceEl = document.getElementById(colId(fromTable, fromColumn));
  if (!svg || !sourceEl) return;

  const canvasRect = canvas.getBoundingClientRect();
  const sr = sourceEl.getBoundingClientRect();
  const x1 = sr.left + sr.width / 2 - canvasRect.left;
  const y1 = sr.top + sr.height / 2 - canvasRect.top;
  const x2 = clientX - canvasRect.left;
  const y2 = clientY - canvasRect.top;

  let line = svg.querySelector('#erd-drag-line');
  if (!line) {
    line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.id = 'erd-drag-line';
    line.setAttribute('stroke', '#163300');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '5 3');
    svg.appendChild(line);
  }
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
}

function clearDragLine(canvas) {
  canvas?.querySelector('#erd-drag-line')?.remove();
}

window.populateManualFkColumns = function(side) {
  const tableSel = document.getElementById(`manual-fk-${side}-table`);
  const colSel = document.getElementById(`manual-fk-${side}-col`);
  const t = tables.find(x => x.name === tableSel.value);
  colSel.innerHTML = (t ? t.columns : []).map(c => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join('');
};

function populateManualFkTableSelects() {
  const opts = tables.map(t => `<option value="${escapeAttr(t.name)}">${escapeHtml(t.name)}</option>`).join('');
  ['from', 'to'].forEach(side => {
    const sel = document.getElementById(`manual-fk-${side}-table`);
    const prev = sel.value;
    sel.innerHTML = opts;
    if (tables.some(t => t.name === prev)) sel.value = prev;
    populateManualFkColumns(side);
  });
}

function renderRelationshipList() {
  const list = document.getElementById('relationship-list');
  if (!relationships.length) {
    list.innerHTML = '<div class="empty">No relationships yet. Suggestions appear here once you have 2+ tables with matching id columns.</div>';
    return;
  }
  list.innerHTML = relationships.map(r => `
    <div class="relationship-row${r.confirmed ? ' confirmed' : ''}">
      <span class="rel-badge ${r.confirmed ? 'confirmed' : 'suggested'}">${r.confirmed ? 'Confirmed' : 'Suggested'}</span>
      ${r.confirmed && r.cardinality ? `<span class="rel-cardinality">${r.cardinality}</span>` : ''}
      <span class="rel-path">${escapeHtml(r.fromTable)}.${escapeHtml(r.fromColumn)} &rarr; ${escapeHtml(r.toTable)}.${escapeHtml(r.toColumn)}</span>
      <span class="rel-actions">
        ${r.confirmed
          ? `<button class="btn btn-secondary btn-sm" onclick="confirmRelationship('${escapeAttr(r.id)}')">Edit</button><button class="btn btn-tertiary btn-sm" onclick="removeRelationship('${escapeAttr(r.id)}')">Remove</button>`
          : `<button class="btn btn-secondary btn-sm" onclick="confirmRelationship('${escapeAttr(r.id)}')">Confirm</button><button class="btn btn-tertiary btn-sm" onclick="rejectRelationship('${escapeAttr(r.id)}')">Reject</button>`}
      </span>
    </div>
  `).join('');
}

// Draws each table as a box (columns listed inside) and overlays an SVG
// connecting confirmed (solid) vs. suggested (dashed, neutral)
// relationships between the specific column rows involved.
function renderERD() {
  const canvas = document.getElementById('erd-canvas');
  if (!canvas) return;

  if (tables.length < 2) {
    canvas.innerHTML = '<div class="empty">Load a second table to see suggested relationships here.</div>';
    return;
  }

  const colId = (table, col) => `erd-col-${cssEscapeId(table)}-${cssEscapeId(col)}`;

  canvas.innerHTML = tables.map(t => `
    <div class="erd-table-box" data-table="${escapeAttr(t.name)}">
      <div class="erd-table-name">${escapeHtml(t.name)}</div>
      ${t.columns.map(c => `<div class="erd-col-row" id="${colId(t.name, c)}" data-table="${escapeAttr(t.name)}" data-column="${escapeAttr(c)}" onmousedown="startRelationshipDrag(event)">${escapeHtml(c)}</div>`).join('')}
    </div>
  `).join('') + '<svg class="erd-svg-overlay"></svg>';

  requestAnimationFrame(() => drawERDLines(canvas, colId));
}

function cssEscapeId(s) {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function drawERDLines(canvas, colId) {
  const svg = canvas.querySelector('.erd-svg-overlay');
  if (!svg) return;
  const canvasRect = canvas.getBoundingClientRect();
  svg.setAttribute('width', canvas.scrollWidth);
  svg.setAttribute('height', canvas.scrollHeight);

  const lines = relationships.map(r => {
    const fromEl = document.getElementById(colId(r.fromTable, r.fromColumn));
    const toEl = document.getElementById(colId(r.toTable, r.toColumn));
    if (!fromEl || !toEl) return '';

    const fr = fromEl.getBoundingClientRect();
    const tr = toEl.getBoundingClientRect();
    const fromOnLeft = fr.left < tr.left;
    const x1 = (fromOnLeft ? fr.right : fr.left) - canvasRect.left;
    const y1 = fr.top + fr.height / 2 - canvasRect.top;
    const x2 = (fromOnLeft ? tr.left : tr.right) - canvasRect.left;
    const y2 = tr.top + tr.height / 2 - canvasRect.top;

    const stroke = r.confirmed ? '#163300' : '#868685';
    const dash = r.confirmed ? '' : 'stroke-dasharray="4 4"';
    const width = r.confirmed ? '2' : '1.5';
    const line = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" ${dash} />`;

    if (!r.confirmed || !r.cardinality) return line;
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const label = `
      <rect x="${mx - 16}" y="${my - 10}" width="32" height="20" rx="10" fill="#e2f6d5" />
      <text x="${mx}" y="${my + 4}" font-size="10" font-family="Inter, system-ui, sans-serif" font-weight="600" text-anchor="middle" fill="#054d28">${r.cardinality}</text>
    `;
    return line + label;
  }).join('');

  svg.innerHTML = lines;
}

// Confirmed relationships are surfaced to the AI as explicit join hints,
// on top of (not instead of) the multi-table schema it already reasons over.
function relationshipHintsText() {
  const confirmed = relationships.filter(r => r.confirmed);
  if (!confirmed.length) return '';
  const lines = confirmed.map(r => `- ${r.fromTable}.${r.fromColumn} -> ${r.toTable}.${r.toColumn}${r.cardinality ? ` (${r.cardinality})` : ''}`).join('\n');
  return `\nConfirmed relationships in this workspace (use these joins when relevant):\n${lines}\n`;
}

// ---- Loading overlay ----

function showLoadingOverlay() {
  const overlay = document.getElementById('loading-overlay');
  const fill = document.getElementById('loading-fill');
  fill.style.transition = 'none';
  fill.style.width = '0%';
  overlay.hidden = false;
  // force reflow so the width reset above is committed before the first update animates
  void fill.offsetWidth;
  fill.style.transition = 'width 150ms linear';
  resetLoadProgress();
}

function hideLoadingOverlay() {
  document.getElementById('loading-overlay').hidden = true;
}

// Progress is driven by real work instead of a fixed animation: callers
// size the bar upfront with addLoadProgressUnits() (sizeLoadProgress),
// then the chunked parse/insert loops call advanceLoadProgress() as each
// chunk actually finishes. The unit is deliberately rough ("one row
// processed, in whichever phase"); the fill is capped below 100% until
// completeLoadProgress() runs, so overestimating just holds a little
// below full instead of overshooting.
let loadProgressTotal = 0;
let loadProgressDone = 0;

function resetLoadProgress() {
  loadProgressTotal = 0;
  loadProgressDone = 0;
  setLoadingFillPct(0);
}

function addLoadProgressUnits(n) {
  loadProgressTotal += n;
}

function advanceLoadProgress(n) {
  loadProgressDone += n;
  const pct = loadProgressTotal > 0 ? (loadProgressDone / loadProgressTotal) * 100 : 0;
  setLoadingFillPct(Math.min(99, pct));
}

function setLoadingFillPct(pct) {
  const fill = document.getElementById('loading-fill');
  if (fill) fill.style.width = pct + '%';
}

function completeLoadProgress(cb) {
  setLoadingFillPct(100);
  setTimeout(() => {
    hideLoadingOverlay();
    if (cb) cb();
  }, 200);
}

// Reads every text file upfront (cheap — this is I/O, not the CPU-heavy
// part) so the progress bar's total is fixed before the real parse/insert
// work starts. Excel workbooks are binary and parsed later by SheetJS, so
// they're sized from file bytes instead (~40 bytes per row-ish, rough).
async function sizeLoadProgress(files) {
  const fileTexts = new Map();
  for (const file of files) {
    if (isXLSXFile(file.name)) {
      addLoadProgressUnits(Math.max(1, Math.round(file.size / 40)) * 3);
      continue;
    }
    const text = await file.text();
    fileTexts.set(file, text);
    const lineCount = Math.max(1, text.split('\n').length);
    // parseJSONText walks its records 3 times; parseCSVText once. Both then
    // pass through normalizeThousandsSeparators and loadFileAsTable's insert.
    const phases = isJSONFile(file.name) ? 5 : 3;
    addLoadProgressUnits(lineCount * phases);
  }
  return fileTexts;
}

function revealApp() {
  setActiveView('app');
}

// ---- Help ----

window.openHelpPanel = function() {
  document.getElementById('help-modal').hidden = false;
};

window.closeHelpPanel = function() {
  document.getElementById('help-modal').hidden = true;
};

// ---- Dismissing modals: Escape and backdrop click ----
// Routed through each modal's own close function (not just hiding the
// overlay) so whatever cleanup that function does still runs.
const MODAL_CLOSE_FN = {
  'signin-required-modal': 'closeSigninRequiredModal',
  'account-modal': 'closeAccountModal',
  'settings-modal': 'closeSettingsPanel',
  'help-modal': 'closeHelpPanel',
  'delete-table-modal': 'closeDeleteTableModal',
  'relationship-type-modal': 'closeRelationshipTypeModal',
  'delete-workspace-modal': 'closeDeleteWorkspaceModal',
  'switch-workspace-modal': 'closeSwitchWorkspaceModal',
};

function closeModalOverlay(overlay) {
  const closeFn = MODAL_CLOSE_FN[overlay.id];
  if (closeFn && typeof window[closeFn] === 'function') window[closeFn]();
  else overlay.hidden = true;
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const openModal = document.querySelector('.modal-overlay:not([hidden])');
  if (openModal) closeModalOverlay(openModal);
});

document.addEventListener('click', (e) => {
  if (e.target.classList?.contains('modal-overlay') && !e.target.hidden) {
    closeModalOverlay(e.target);
  }
});

// ---- Modal accessibility: focus trap + aria wiring ----
// Wired centrally off the `hidden` attribute instead of from each
// open*/close* function pair — a MutationObserver means none of them needs
// to remember to call anything, and a modal added later gets this for free
// just by using the .modal-overlay/.modal markup convention. (The React
// island's own modals manage focus themselves.)
(function setupModalAccessibility() {
  const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const isVisible = (el) => el.offsetParent !== null;

  // A stack, not a single slot: closing an inner modal opened from within
  // an outer one should hand Tab-trapping back to the outer modal.
  const trapStack = [];

  function trapKeydown(e) {
    if (e.key !== 'Tab' || trapStack.length === 0) return;
    const overlay = trapStack[trapStack.length - 1].overlay;
    const focusables = Array.from(overlay.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisible);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function activateModal(overlay) {
    trapStack.push({ overlay, trigger: document.activeElement });
    if (trapStack.length === 1) document.addEventListener('keydown', trapKeydown, true);

    const focusables = Array.from(overlay.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisible);
    const target = overlay.querySelector('[autofocus]') || focusables[0];
    if (target) {
      target.focus();
    } else {
      const card = overlay.querySelector('.modal') || overlay;
      if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '-1');
      card.focus();
    }
  }

  function deactivateModal(overlay) {
    const i = trapStack.findIndex(t => t.overlay === overlay);
    if (i === -1) return;
    const [{ trigger }] = trapStack.splice(i, 1);
    if (trapStack.length === 0) document.removeEventListener('keydown', trapKeydown, true);
    if (trigger && typeof trigger.focus === 'function' && document.body.contains(trigger)) {
      trigger.focus();
    }
  }

  function wireOverlay(overlay) {
    if (overlay.dataset.a11yWired) return;
    overlay.dataset.a11yWired = 'true';
    if (!overlay.hasAttribute('role')) overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName !== 'hidden') continue;
        if (overlay.hidden) deactivateModal(overlay);
        else activateModal(overlay);
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
    if (!overlay.hidden) activateModal(overlay);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal-overlay').forEach(wireOverlay);
  });
})();
