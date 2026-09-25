// dashboard/src/ExportModal.jsx — the export flow (BUILD-INSTRUCTIONS.md §5.6),
// opened from the Dashboard's "Export" button:
//   1. Select — which outputs (Power BI, Tableau, dashboard image) and which
//      tables, defaulted to everything the dashboard uses.
//   2. Sign-in gate (Lite Mode only) — inline, not a redirect, so the
//      selection isn't lost; signing in flips straight to step 3.
//   3. Download — one .zip: an Excel Table per table (Power BI's "Get Data
//      -> Excel workbook"), a .tds per table next to its workbook (Tableau),
//      the dashboard image, a README with the how-to-open steps, and a tile
//      list with each tile's SQL for rebuilding visuals. An image-only
//      export downloads the .png directly.
// The destination-preview step of §5.6 arrives with the v1.1 preview skins.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { bridge, useCurrentUser } from './bridge.js';
import { buildAllTds } from './lib/tdsExport.js';
import { renderDashboardPng } from './lib/dashboardImage.js';
import { tileDisplayTitle } from './Tile.jsx';

function tablesUsedBy(tile, tableNames) {
  if (!tile.sql) return [];
  const sql = tile.sql.replace(/'(?:[^']|'')*'/g, "''");
  return tableNames.filter(name => new RegExp(`\\b(from|join)\\s+"?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"?(?![A-Za-z0-9_])`, 'i').test(sql));
}

function buildReadme({ dashboardName, tables, excel, tableau, image }) {
  const lines = [
    `${dashboardName} — exported from Synth-BI`,
    '='.repeat(Math.min(72, dashboardName.length + 26)),
    '',
  ];
  if (excel || tableau) {
    lines.push('Files', '-----');
    tables.forEach(t => lines.push(`  ${t.name}.xlsx   ${t.rowCount.toLocaleString()} rows, one Excel Table named "${t.name}"${tableau ? `\n  ${t.name}.tds    Tableau data source for ${t.name}.xlsx` : ''}`));
    if (image) lines.push('  dashboard.png   the dashboard as it looked when exported');
    lines.push('  tiles.txt       every tile with its chart type and SQL', '');
  }
  if (excel) {
    lines.push('Power BI', '--------',
      '1. Home > Get Data > Excel workbook, then pick one of the .xlsx files.',
      '2. In the Navigator, tick the Table (not the sheet) and click Load. Columns arrive typed: numbers as numbers, dates as dates.',
      '3. Repeat for each table, then connect them in Model view if they relate.',
      '4. Rebuild each visual from tiles.txt: same fields, same chart type.', '');
  }
  if (tableau) {
    lines.push('Tableau', '-------',
      '1. Keep each .tds in the same folder as its .xlsx.',
      '2. Double-click a .tds file: Tableau opens already connected, with field names, types, and measures/dimensions set.',
      '   (If Tableau asks where the data file is, point it at the matching .xlsx in this folder.)',
      '3. Rebuild each visual from tiles.txt on a new worksheet.', '');
  }
  lines.push('Your data never left your browser: these files were generated on your computer.');
  return lines.join('\n');
}

function buildTilesText(tiles) {
  const charts = tiles.filter(t => t.kind !== 'text');
  return charts.map((t, i) => {
    const spec = t.chartSpec || {};
    const fields = [
      spec.category ? `category: ${spec.category}` : null,
      spec.values && spec.values.length ? `values: ${spec.values.join(', ')}` : null,
      spec.seriesBy ? `split by: ${spec.seriesBy}` : null,
    ].filter(Boolean).join(' · ');
    return `${i + 1}. ${tileDisplayTitle(t)}\n   Chart: ${spec.type || 'auto'}${fields ? ` (${fields})` : ''}\n   SQL:\n${String(t.sql).split('\n').map(l => `     ${l}`).join('\n')}\n`;
  }).join('\n');
}

export default function ExportModal({ tiles, schema, onClose }) {
  const user = useCurrentUser();
  const tableNames = useMemo(() => schema.map(t => t.name), [schema]);
  const usage = useMemo(() => {
    const map = Object.fromEntries(tableNames.map(n => [n, 0]));
    tiles.forEach(t => tablesUsedBy(t, tableNames).forEach(n => { map[n]++; }));
    return map;
  }, [tiles, tableNames]);
  const [selected, setSelected] = useState(() => {
    const used = tableNames.filter(n => usage[n] > 0);
    return new Set(used.length ? used : tableNames);
  });
  const [outputs, setOutputs] = useState({ excel: true, tableau: true, image: true });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const dialogRef = useRef(null);

  useEffect(() => {
    const first = dialogRef.current && dialogRef.current.querySelector('input, button');
    if (first) first.focus();
    const onKey = e => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const toggleTable = name => setSelected(s => {
    const next = new Set(s);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const wantsData = outputs.excel || outputs.tableau;
  const nothing = !outputs.excel && !outputs.tableau && !outputs.image;
  const noTables = wantsData && selected.size === 0;

  const run = async () => {
    setError('');
    setDone('');
    setBusy(true);
    try {
      let image = null;
      if (outputs.image) {
        setStatus('Drawing the dashboard image…');
        const grid = document.querySelector('.dash-grid') || document.querySelector('.dash-stack');
        const bg = getComputedStyle(document.querySelector('.dash')).backgroundColor;
        if (grid) image = await renderDashboardPng(grid, { background: bg, scale: 2 });
      }
      const chosen = schema.filter(t => selected.has(t.name));
      const dashboardName = (document.getElementById('workspace-name') || {}).textContent || 'Dashboard';
      const name = await bridge.exportDashboard({
        tableNames: chosen.map(t => t.name),
        excel: outputs.excel,
        tableau: outputs.tableau,
        tdsFiles: outputs.tableau ? buildAllTds(chosen) : [],
        image,
        files: wantsData ? [
          { path: 'README.txt', text: buildReadme({ dashboardName, tables: chosen, ...outputs }) },
          { path: 'tiles.txt', text: buildTilesText(tiles) },
        ] : [],
        onStatus: setStatus,
      });
      setStatus('');
      setDone(name);
    } catch (err) {
      setStatus('');
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const Option = ({ id, icon, title, body }) => (
    <label className={`export-option${outputs[id] ? ' is-on' : ''}`}>
      <input type="checkbox" checked={outputs[id]} onChange={e => setOutputs(o => ({ ...o, [id]: e.target.checked }))} />
      <i className={`ph ${icon}`} aria-hidden="true" />
      <span>
        <strong>{title}</strong>
        <span>{body}</span>
      </span>
    </label>
  );

  return createPortal(
    <div className="tile-editor-overlay island-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title" ref={dialogRef}>
        <header className="export-header">
          <h2 id="export-title">Export dashboard</h2>
          <button type="button" className="btn btn-icon" onClick={onClose} aria-label="Close" disabled={busy}><i className="ph ph-x" aria-hidden="true" /></button>
        </header>

        <div className="export-body">
          <section>
            <h3 className="export-step">What to include</h3>
            <div className="export-options">
              <Option id="excel" icon="ph-file-xls" title="Power BI" body="An Excel Table per table, with typed numbers and dates, ready for Get Data → Excel workbook." />
              <Option id="tableau" icon="ph-database" title="Tableau" body="A .tds data source per table: double-click it to open Tableau already connected and typed." />
              <Option id="image" icon="ph-file-image" title="Dashboard image" body="A PNG of the canvas as it looks now, for slides and docs." />
            </div>
          </section>

          {wantsData && (
            <section>
              <h3 className="export-step">Tables</h3>
              <div className="export-tables">
                {schema.map(t => (
                  <label key={t.name} className="export-table">
                    <input type="checkbox" checked={selected.has(t.name)} onChange={() => toggleTable(t.name)} />
                    <span className="export-table-name">{t.name}</span>
                    <span className="export-table-meta">{t.rowCount.toLocaleString()} rows · {usage[t.name] ? `used by ${usage[t.name]} tile${usage[t.name] === 1 ? '' : 's'}` : 'not used by a tile'}</span>
                  </label>
                ))}
              </div>
              <p className="field-hint">Visuals are rebuilt inside Power BI and Tableau from the data — the bundle's tiles.txt lists every tile's fields and SQL, and the image shows the layout.</p>
            </section>
          )}
        </div>

        <footer className="export-footer">
          {!user ? (
            <div className="export-gate">
              <i className="ph ph-lock-simple" aria-hidden="true" />
              <span><strong>Export needs a free account.</strong> Your selections stay here while you sign in.</span>
              <button type="button" className="btn btn-tertiary btn-sm" onClick={() => window.openAccountModal && window.openAccountModal('signin')}>Sign in</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => window.openAccountModal && window.openAccountModal('signup')}>Create account</button>
            </div>
          ) : (
            <>
              <div className="export-status" role="status" aria-live="polite">
                {error ? <span className="is-error">{error}</span> : done ? <span className="is-done"><i className="ph ph-check-circle" aria-hidden="true" /> Downloaded {done}</span> : status}
              </div>
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{done ? 'Done' : 'Cancel'}</button>
              <button type="button" className="btn btn-primary" onClick={run} disabled={busy || nothing || noTables}>
                <i className="ph ph-download-simple" aria-hidden="true" /> {busy ? 'Preparing…' : wantsData ? 'Download .zip' : 'Download image'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body
  );
}
