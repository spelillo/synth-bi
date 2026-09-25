// dashboard/src/TileEditor.jsx — per-tile query + chart-type editor, opened
// from "+ Add tile" or by clicking an existing tile. This is the manual
// tile-building path (Lite Mode's only path; also available in Normal Mode
// alongside AI-built tiles), replacing synth-sql's single persistent query
// box now that the workspace holds several queries at once.
//
// Two modes, toggled at the top (same visual pattern as the Ask/Agent and
// SQL/General toggles elsewhere in the app) — decided over raw SQL alone:
//
//   - Visual: table picker, group-by column, measure column + aggregate
//     (SUM/AVG/COUNT/MIN/MAX), optional filter, chart-type picker. Builds a
//     SQL string under the hood (lib/visualSql.js) and shows it read-only
//     underneath — never a black box, even in Visual mode.
//   - SQL: the direct port of synth-sql's query editor (SqlEditor.jsx: line
//     numbers, syntax highlighting textarea) — write the query by hand.
//
// Switching Visual -> SQL pre-fills the SQL box with the generated query,
// editable from there. Switching back SQL -> Visual after hand-editing warns
// that it'll regenerate the query from the visual fields (one-way, same
// "can't always round-trip a hand-written query into a builder" tradeoff
// most BI tools make).
//
// Both modes converge on the same tile shape: { sql, chartSpec } (plus
// optional `source` so a Visual tile reopens in Visual mode). Runs via
// bridge.js's runQuery(), previews live through Tile.jsx's render path
// before "Add to dashboard" commits it.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CHART_TYPES, chartTypeAllowed, heuristicChartSpec, analyzeChartColumns, MAX_PIE_SLICES, MAX_SCATTER_SERIES, MAX_SERIES } from '../../shared/chart-engine.js';
import Segmented from './Segmented.jsx';
import SqlEditor from './SqlEditor.jsx';
import { ChartCanvas, chartFromResult, runTileQuery } from './Tile.jsx';
import { AGGREGATES, DATE_GRAINS, FILTER_OPS, buildVisualSql, defaultVisual, reconcileVisual } from './lib/visualSql.js';

const KIND_ICON = { numeric: 'ph-hash', date: 'ph-calendar-blank', text: 'ph-text-aa' };

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Chart settings the user has touched. `undefined` means "auto" — derived
// from the current result each time, so changing the query re-picks
// sensible axes until the user takes over that particular setting.
function chartStateFromStored(stored) {
  if (!stored) return { type: undefined, category: undefined, values: undefined, title: '', xAxisTitle: '', yAxisTitle: '' };
  return {
    type: stored.type || undefined,
    category: stored.category === undefined ? undefined : stored.category,
    values: Array.isArray(stored.values) && stored.values.length ? stored.values : undefined,
    title: stored.title || '',
    xAxisTitle: stored.xAxisTitle || '',
    yAxisTitle: stored.yAxisTitle || '',
  };
}

// Turns a result + the user's chart settings into the stored (name-based)
// chartSpec. Visual mode knows its own column layout (group, then
// measure), so it maps axes explicitly instead of guessing.
function storedSpecFor(result, chartState, { visualGrouped } = {}) {
  if (!result || result.error || !result.columns || !result.rows || !result.rows.length) return null;
  const cols = result.columns;
  const heuristic = heuristicStored(result);
  const auto = visualGrouped === undefined
    ? heuristic
    : { type: heuristic.type || 'column', category: visualGrouped ? cols[0] : null, values: [cols[cols.length - 1]] };
  const has = name => name === null || cols.includes(name);
  return {
    type: chartState.type || auto.type,
    category: chartState.category !== undefined && has(chartState.category) ? chartState.category : auto.category,
    values: chartState.values && chartState.values.every(has) ? chartState.values : auto.values,
    title: chartState.title,
    xAxisTitle: chartState.xAxisTitle,
    yAxisTitle: chartState.yAxisTitle,
  };
}

// The chart engine's own pick for an arbitrary result, as a stored spec.
function heuristicStored(result) {
  const info = analyzeChartColumns(result.columns, result.rows);
  const h = heuristicChartSpec(info, result.rows.length);
  if (h.error) return {};
  return { type: h.type, category: h.category >= 0 ? info[h.category].name : null, values: h.values.map(v => info[v].name) };
}

function initialEditorState(tile, draft, schema) {
  const source = tile || draft;
  if (source && source.source && source.source.mode === 'visual' && source.source.visual) {
    const visual = reconcileVisual(source.source.visual, schema);
    if (visual) return { mode: 'visual', visual, sql: source.sql, chart: chartStateFromStored(source.chartSpec) };
  }
  if (source) return { mode: 'sql', visual: defaultVisual(schema[0]), sql: source.sql || '', chart: chartStateFromStored(source.chartSpec) };
  return { mode: 'visual', visual: defaultVisual(schema[0]), sql: '', chart: chartStateFromStored(null) };
}

function Field({ label, children, hint, className = '' }) {
  const id = useId();
  return (
    <div className={`field ${className}`}>
      <label className="field-label" htmlFor={id}>{label}</label>
      {typeof children === 'function' ? children(id) : children}
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

function ColumnOptions({ columns, filter }) {
  return columns.filter(filter || (() => true)).map(c => (
    <option key={c.name} value={c.name}>{c.name}{c.kind !== 'text' ? ` · ${c.kind === 'numeric' ? 'number' : 'date'}` : ''}</option>
  ));
}

function DataPreview({ result }) {
  const rows = result.rows.slice(0, 100);
  return (
    <div className="data-preview">
      <table>
        <thead><tr>{result.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>{row.map((v, i) => <td key={i}>{v === null || v === undefined ? <span className="null">NULL</span> : String(v)}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {result.rows.length > rows.length && <div className="data-preview-note">First {rows.length} of {result.rows.length.toLocaleString()}{result.truncated ? '+' : ''} rows</div>}
    </div>
  );
}

export default function TileEditor({ tile, draft, schema, schemaVersion, previewMode, onSave, onClose }) {
  const initial = useMemo(() => initialEditorState(tile, draft, schema), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState(initial.mode);
  const [visual, setVisual] = useState(initial.visual);
  const [sqlText, setSqlText] = useState(initial.sql);
  const [ranSql, setRanSql] = useState(initial.mode === 'sql' ? initial.sql : '');
  const [sqlBaseline, setSqlBaseline] = useState(initial.mode === 'sql' && initial.visual ? null : '');
  const [confirmVisualSwitch, setConfirmVisualSwitch] = useState(false);
  const [chartState, setChartState] = useState(initial.chart);
  const [previewTab, setPreviewTab] = useState('chart');
  const [saveError, setSaveError] = useState('');
  const dialogRef = useRef(null);

  const table = visual ? schema.find(t => t.name === visual.table) : null;
  const generatedSql = useMemo(() => buildVisualSql(visual, schema), [visual, schema]);
  const debouncedGenerated = useDebounced(generatedSql, 180);
  const activeSql = mode === 'visual' ? debouncedGenerated : ranSql;
  const visualGrouped = mode === 'visual' ? !!(visual && visual.groupBy) : undefined;

  const result = useMemo(() => (activeSql.trim() ? runTileQuery(activeSql) : null), [activeSql, schemaVersion]);
  const storedSpec = useMemo(() => storedSpecFor(result, chartState, { visualGrouped }), [result, chartState, visualGrouped]);
  const chart = useMemo(() => chartFromResult(result, storedSpec), [result, storedSpec]);
  const sqlDirty = mode === 'sql' && sqlText.trim() !== ranSql.trim();

  // A query change that drops a column the user had pinned an axis to
  // hands that axis back to auto.
  const columnsKey = result && result.columns ? result.columns.join('\u0001') : '';
  useEffect(() => {
    if (!result || !result.columns) return;
    const cols = new Set(result.columns);
    setChartState(s => {
      const next = { ...s };
      if (s.category !== undefined && s.category !== null && !cols.has(s.category)) next.category = undefined;
      if (s.values && s.values.some(v => !cols.has(v))) next.values = undefined;
      return next.category === s.category && next.values === s.values ? s : next;
    });
  }, [columnsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = dialogRef.current;
    const first = el && el.querySelector('select, textarea, input, button.segmented-btn.is-active');
    if (first) first.focus();
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateVisual = patch => setVisual(v => ({ ...v, ...patch }));

  const switchMode = next => {
    if (next === mode) return;
    if (next === 'sql') {
      const sql = generatedSql || sqlText;
      setSqlText(sql);
      setRanSql(sql);
      setSqlBaseline(sql);
      setMode('sql');
      return;
    }
    if (sqlBaseline === null || sqlText.trim() !== sqlBaseline.trim()) {
      setConfirmVisualSwitch(true);
      return;
    }
    setMode('visual');
  };

  const confirmSwitchToVisual = () => {
    setConfirmVisualSwitch(false);
    setMode('visual');
    if (!visual || !schema.some(t => t.name === visual.table)) setVisual(defaultVisual(schema[0]));
  };

  const runSql = () => { setSaveError(''); setRanSql(sqlText); };

  const setTableFor = name => {
    const t = schema.find(x => x.name === name);
    setVisual(defaultVisual(t));
    setChartState(s => ({ ...s, category: undefined, values: undefined }));
  };

  const save = () => {
    setSaveError('');
    const finalSql = mode === 'visual' ? generatedSql : sqlText;
    if (!finalSql.trim()) { setSaveError('Build or write a query first.'); return; }
    const res = runTileQuery(finalSql);
    const spec = storedSpecFor(res, chartState, { visualGrouped });
    const check = chartFromResult(res, spec);
    if (check.error) {
      if (mode === 'sql') setRanSql(sqlText);
      setSaveError(check.kind === 'query' ? `The query failed: ${check.error}` : check.error);
      return;
    }
    const titleSet = !!chartState.title.trim();
    onSave({
      sql: finalSql.trim(),
      chartSpec: {
        type: check.spec.type,
        title: titleSet ? chartState.title.trim() : '',
        category: check.spec.category >= 0 ? check.info[check.spec.category].name : null,
        values: check.spec.values.map(v => check.info[v].name),
        xAxisTitle: chartState.xAxisTitle.trim(),
        yAxisTitle: chartState.yAxisTitle.trim(),
      },
      source: mode === 'visual' ? { mode: 'visual', visual } : { mode: 'sql' },
    });
  };

  // ---- chart controls (both modes) ----
  const info = chart.info || null;
  const spec = chart.spec || null;
  const rowCount = result && result.rows ? result.rows.length : 0;
  const isPie = spec && (spec.type === 'pie' || spec.type === 'doughnut');
  const maxSeries = spec ? (spec.type === 'scatter' ? MAX_SCATTER_SERIES : isPie ? 1 : MAX_SERIES) : MAX_SERIES;
  const numericCols = info ? info.filter(c => c.kind === 'numeric' && (!spec || c.index !== spec.category)) : [];

  const setChart = patch => setChartState(s => ({ ...s, ...patch }));
  const toggleValue = name => {
    const current = spec ? spec.values.map(v => info[v].name) : [];
    const next = current.includes(name) ? current.filter(n => n !== name) : [...current, name].slice(-maxSeries);
    if (next.length) setChart({ values: next });
  };

  const measureAgg = visual ? AGGREGATES.find(a => a.id === visual.agg) : null;
  const measureFilter = visual && visual.agg === 'count_distinct'
    ? () => true
    : visual && (visual.agg === 'min' || visual.agg === 'max')
      ? c => c.kind === 'numeric' || c.kind === 'date'
      : c => c.kind === 'numeric';
  const groupCol = table && visual.groupBy ? table.columns.find(c => c.name === visual.groupBy) : null;
  const filterCol = table && visual.filter.column ? table.columns.find(c => c.name === visual.filter.column) : null;
  const filterOp = visual ? FILTER_OPS.find(o => o.id === visual.filter.op) || FILTER_OPS[0] : null;
  const displayTitle = chartState.title || (spec && spec.title) || '';

  const titleId = useId();

  return createPortal(
    <div className="tile-editor-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tile-editor" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
        <header className="tile-editor-header">
          <h2 id={titleId}>{tile ? 'Edit tile' : draft ? 'Review suggested tile' : 'Add a tile'}</h2>
          <Segmented
            label="Build mode"
            value={mode}
            onChange={switchMode}
            options={[
              { id: 'visual', label: 'Visual', icon: 'ph-sliders-horizontal' },
              { id: 'sql', label: 'SQL', icon: 'ph-code' },
            ]}
          />
          <button type="button" className="btn btn-icon tile-editor-close" onClick={onClose} aria-label="Close"><i className="ph ph-x" aria-hidden="true" /></button>
        </header>

        {confirmVisualSwitch && (
          <div className="inline-notice" role="alert">
            <i className="ph ph-warning" aria-hidden="true" />
            <span>Switching to Visual rebuilds the query from the visual fields. Your SQL edits will be replaced.</span>
            <div className="inline-notice-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmVisualSwitch(false)}>Keep my SQL</button>
              <button type="button" className="btn btn-tertiary btn-sm" onClick={confirmSwitchToVisual}>Switch to Visual</button>
            </div>
          </div>
        )}

        <div className="tile-editor-body">
          <section className="tile-editor-config" aria-label="Query">
            {mode === 'visual' && visual ? (
              <div className="visual-fields">
                {schema.length > 1 ? (
                  <Field label="Table">
                    {id => (
                      <select id={id} className="select" value={visual.table} onChange={e => setTableFor(e.target.value)}>
                        {schema.map(t => <option key={t.name} value={t.name}>{t.name} ({t.rowCount.toLocaleString()} rows)</option>)}
                      </select>
                    )}
                  </Field>
                ) : (
                  <div className="field">
                    <span className="field-label">Table</span>
                    <span className="field-static"><i className="ph ph-table" aria-hidden="true" /> {visual.table}</span>
                  </div>
                )}

                <div className="field-row">
                  <Field label="Group by" className="grow">
                    {id => (
                      <select id={id} className="select" value={visual.groupBy} onChange={e => {
                        const col = table.columns.find(c => c.name === e.target.value);
                        updateVisual({ groupBy: e.target.value, dateGrain: col && col.isoDate ? 'month' : 'none' });
                      }}>
                        <option value="">(nothing — one total)</option>
                        {table && <ColumnOptions columns={table.columns} />}
                      </select>
                    )}
                  </Field>
                  {groupCol && groupCol.isoDate && (
                    <Field label="Dates by">
                      {id => (
                        <select id={id} className="select" value={visual.dateGrain} onChange={e => updateVisual({ dateGrain: e.target.value })}>
                          {DATE_GRAINS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                        </select>
                      )}
                    </Field>
                  )}
                </div>

                <div className="field-row">
                  <Field label="Measure" className="grow">
                    {id => (
                      <select id={id} className="select" value={visual.agg} onChange={e => {
                        const agg = e.target.value;
                        const a = AGGREGATES.find(x => x.id === agg);
                        let measure = visual.measure;
                        const col = table.columns.find(c => c.name === measure);
                        const ok = col && (agg === 'count_distinct' || col.kind === 'numeric' || ((agg === 'min' || agg === 'max') && col.kind === 'date'));
                        if (a.needsColumn && !ok) {
                          const fallback = table.columns.find(c => (agg === 'count_distinct' ? true : c.kind === 'numeric'));
                          measure = fallback ? fallback.name : '';
                        }
                        updateVisual({ agg, measure });
                      }}>
                        {AGGREGATES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                      </select>
                    )}
                  </Field>
                  {measureAgg && measureAgg.needsColumn && (
                    <Field label="of column" className="grow">
                      {id => (
                        <select id={id} className="select" value={visual.measure} onChange={e => updateVisual({ measure: e.target.value })}>
                          {!visual.measure && <option value="">Choose a column</option>}
                          {table && <ColumnOptions columns={table.columns} filter={measureFilter} />}
                        </select>
                      )}
                    </Field>
                  )}
                </div>
                {measureAgg && measureAgg.needsColumn && table && !table.columns.some(measureFilter) && (
                  <p className="field-hint is-warning">This table has no number columns to {measureAgg.label.toLowerCase()}. Try “Count of rows” or “Count distinct”.</p>
                )}

                <fieldset className="filter-fieldset">
                  <legend className="field-label">Filter <span className="field-optional">optional</span></legend>
                  <div className="field-row">
                    <select className="select grow" aria-label="Filter column" value={visual.filter.column} onChange={e => updateVisual({ filter: { ...visual.filter, column: e.target.value } })}>
                      <option value="">No filter</option>
                      {table && <ColumnOptions columns={table.columns} />}
                    </select>
                    {visual.filter.column && (
                      <select className="select" aria-label="Filter condition" value={visual.filter.op} onChange={e => updateVisual({ filter: { ...visual.filter, op: e.target.value } })}>
                        {FILTER_OPS.filter(o => !o.numericOnly || (filterCol && (filterCol.kind === 'numeric' || filterCol.kind === 'date'))).map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    )}
                    {visual.filter.column && filterOp && filterOp.needsValue && (
                      <input className="text-input text-input-sm grow" aria-label="Filter value" placeholder="value" value={visual.filter.value} onChange={e => updateVisual({ filter: { ...visual.filter, value: e.target.value } })} />
                    )}
                  </div>
                </fieldset>

                <div className="generated-sql">
                  <div className="generated-sql-head">
                    <span className="field-label">SQL for these picks</span>
                    <button type="button" className="link-btn" onClick={() => switchMode('sql')}>Edit as SQL <i className="ph ph-arrow-right" aria-hidden="true" /></button>
                  </div>
                  <SqlEditor value={generatedSql} onChange={() => {}} readOnly minHeight={60} maxHeight={220} ariaLabel="Generated SQL (read-only)" />
                </div>
              </div>
            ) : (
              <div className="sql-fields">
                <SqlEditor value={sqlText} onChange={setSqlText} onRun={runSql} />
                <div className="sql-run-row">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={runSql} disabled={!sqlText.trim()}>
                    <i className="ph ph-play" aria-hidden="true" /> Run query
                  </button>
                  <span className="field-hint">{sqlDirty ? 'Edited — run to update the preview.' : '⌘/Ctrl + Enter runs it. Read-only: SELECT or WITH.'}</span>
                </div>
                <details className="schema-helper">
                  <summary>Tables &amp; columns</summary>
                  <div className="schema-helper-body">
                    {schema.map(t => (
                      <div key={t.name} className="schema-helper-table">
                        <div className="schema-helper-name">{t.name}</div>
                        <div className="schema-helper-cols">
                          {t.columns.map(c => (
                            <code key={c.name} title={c.kind}><i className={`ph ${KIND_ICON[c.kind] || 'ph-text-aa'}`} aria-hidden="true" /> {c.name}</code>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              </div>
            )}

            <div className="chart-settings">
              <h3 className="chart-settings-title">Chart</h3>
              <div className="chart-type-grid" role="radiogroup" aria-label="Chart type">
                {CHART_TYPES.map(t => {
                  const allowed = info ? chartTypeAllowed(t.id, info, rowCount) : true;
                  const active = spec && spec.type === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={!!active}
                      aria-label={t.label}
                      className={`chart-type-btn${active ? ' is-active' : ''}`}
                      disabled={!info || !allowed}
                      title={!allowed ? (t.id === 'scatter' ? 'Needs 2 number columns' : `Needs ${MAX_PIE_SLICES} rows or fewer`) : t.label}
                      onClick={() => setChart({ type: t.id })}
                    >
                      <i className={`ph ${{ column: 'ph-chart-bar', bar: 'ph-chart-bar-horizontal', line: 'ph-chart-line', area: 'ph-chart-line-up', pie: 'ph-chart-pie', doughnut: 'ph-chart-donut', scatter: 'ph-chart-scatter' }[t.id]}`} aria-hidden="true" />
                      <span>{t.label.replace(' (horizontal)', '')}</span>
                    </button>
                  );
                })}
              </div>

              {spec && info && (
                <>
                  <div className="field-row">
                    <Field label={isPie ? 'Slices' : spec.type === 'scatter' ? 'X axis' : 'Categories'} className="grow">
                      {id => (
                        <select id={id} className="select" value={spec.category >= 0 ? info[spec.category].name : ''} onChange={e => setChart({ category: e.target.value === '' ? null : e.target.value })}>
                          {spec.type !== 'scatter' && <option value="">(row number)</option>}
                          {(spec.type === 'scatter' ? info.filter(c => c.kind === 'numeric') : info).map(c => <option key={c.index} value={c.name}>{c.name}</option>)}
                        </select>
                      )}
                    </Field>
                    <div className="field grow">
                      <span className="field-label">{isPie ? 'Value' : 'Values'}</span>
                      <div className="value-chips">
                        {numericCols.length ? numericCols.map(c => {
                          const on = spec.values.includes(c.index);
                          return (
                            <button key={c.index} type="button" className={`value-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggleValue(c.name)}>
                              {on && <i className="ph ph-check" aria-hidden="true" />} {c.name}
                            </button>
                          );
                        }) : <span className="field-hint">No number columns in this result.</span>}
                      </div>
                    </div>
                  </div>
                  <Field label="Title">
                    {id => <input id={id} className="text-input text-input-sm" value={chartState.title} placeholder={spec.title} onChange={e => setChart({ title: e.target.value })} />}
                  </Field>
                  {!isPie && (
                    <details className="axis-titles">
                      <summary>Axis titles</summary>
                      <div className="field-row">
                        <Field label={spec.type === 'bar' ? 'Category axis (left)' : 'X axis'} className="grow">
                          {id => <input id={id} className="text-input text-input-sm" value={chartState.xAxisTitle} placeholder={spec.xAxisTitle} onChange={e => setChart({ xAxisTitle: e.target.value })} />}
                        </Field>
                        <Field label={spec.type === 'bar' ? 'Value axis (bottom)' : 'Y axis'} className="grow">
                          {id => <input id={id} className="text-input text-input-sm" value={chartState.yAxisTitle} placeholder={spec.yAxisTitle} onChange={e => setChart({ yAxisTitle: e.target.value })} />}
                        </Field>
                      </div>
                    </details>
                  )}
                </>
              )}
            </div>
          </section>

          <section className="tile-editor-preview" aria-label="Preview">
            <div className="preview-head">
              <span className="preview-label">Preview</span>
              {result && !result.error && result.rows && result.rows.length > 0 && (
                <Segmented size="sm" label="Preview as" value={previewTab} onChange={setPreviewTab} options={[{ id: 'chart', label: 'Chart' }, { id: 'data', label: 'Data' }]} />
              )}
            </div>
            <div className="preview-card">
              <div className="preview-card-title">{displayTitle || (spec && spec.title) || 'Untitled tile'}</div>
              <div className="preview-card-body">
                {!result ? (
                  <div className="tile-message"><i className="ph ph-chart-bar" aria-hidden="true" /><span>{mode === 'sql' ? 'Write a query and run it to preview the tile.' : 'Pick a table and a measure to preview the tile.'}</span></div>
                ) : previewTab === 'data' && result.rows && result.rows.length ? (
                  <DataPreview result={result} />
                ) : chart.error ? (
                  <div className={`tile-message${chart.kind === 'query' ? ' is-error' : ''}`}>
                    <i className={`ph ${chart.kind === 'query' ? 'ph-warning-circle' : 'ph-chart-bar'}`} aria-hidden="true" />
                    <span>{chart.error}</span>
                  </div>
                ) : (
                  <ChartCanvas spec={chart.spec} data={chart.data} previewMode={previewMode} compact={false} />
                )}
              </div>
            </div>
            {result && result.rows && (
              <p className="preview-meta">
                {result.rows.length.toLocaleString()}{result.truncated ? '+' : ''} row{result.rows.length === 1 ? '' : 's'} · {result.columns.length} column{result.columns.length === 1 ? '' : 's'}
                {chart.data && chart.data.shown < chart.data.total ? ` · charting the first ${chart.data.shown.toLocaleString()}` : ''}
              </p>
            )}
          </section>
        </div>

        <footer className="tile-editor-footer">
          {saveError && <p className="tile-editor-error" role="alert">{saveError}</p>}
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={mode === 'visual' ? !generatedSql : !sqlText.trim()}>
            {tile ? 'Save tile' : 'Add to dashboard'}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
