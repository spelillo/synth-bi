// dashboard/src/TileEditor.jsx — per-tile query + chart editor, opened from
// "+ Add tile", by clicking an existing tile, or (Build mode) with an AI
// draft to fine-tune before it's added. This is the manual tile-building
// path (Lite Mode's only path; also Normal Mode's review step for AI tiles),
// replacing synth-sql's single persistent query box now that the workspace
// holds several queries at once.
//
// Three panels on the left, one live preview on the right:
//   - Data: the Visual / SQL toggle (same pattern as the Ask/Build and
//     SQL/General toggles elsewhere in the app) — decided over raw SQL alone:
//       * Visual: table, group-by (+ date grain), split-by, measure +
//         aggregate, optional filter. Builds SQL (lib/visualSql.js) and shows
//         it read-only underneath — never a black box.
//       * SQL: the port of synth-sql's query editor (SqlEditor.jsx).
//     Switching Visual -> SQL pre-fills the SQL box with the generated query;
//     switching back after hand-editing warns that it'll regenerate the query
//     from the visual fields (one-way, the usual BI-tool tradeoff).
//   - Visual: the chart-type gallery (shared/chart-engine.js CHART_TYPES) and
//     field wells — categories, values, split by, bubble size, table columns.
//   - Format: palette + per-series colors, data labels, legend, gridlines,
//     number format, and the tile's own look (title, background, border).
//
// Everything converges on one tile shape: { sql, chartSpec, appearance,
// source }. chartSpec is name-based (see state.js) and carries chart style;
// `appearance` is tile chrome; `source` lets a Visual tile reopen in Visual.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CHART_TYPES, CHART_TYPE_GROUPS, PALETTES, DEFAULT_STYLE,
  chartTypeAllowed, chartTypeHint, heuristicChartSpec, analyzeChartColumns,
  maxValuesFor, supportsSeriesBy, applyChartStyle,
} from '../../shared/chart-engine.js';
import { getChartTheme } from '../../shared/chart-themes.js';
import Segmented from './Segmented.jsx';
import SqlEditor from './SqlEditor.jsx';
import { ChartCanvas, TileFrame, DEFAULT_APPEARANCE, chartFromResult, runTileQuery, surfaceOverrides } from './Tile.jsx';
import { SwatchPicker } from './TextTile.jsx';
import { AGGREGATES, DATE_GRAINS, FILTER_OPS, buildVisualSql, defaultVisual, reconcileVisual } from './lib/visualSql.js';

const KIND_ICON = { numeric: 'ph-hash', date: 'ph-calendar-blank', text: 'ph-text-aa' };
const NUMBER_FORMATS = [
  { id: 'auto', label: 'Automatic' },
  { id: 'compact', label: 'Compact (1.2K)' },
  { id: 'currency', label: 'Currency ($)' },
  { id: 'percent', label: 'Percent (%)' },
  { id: 'integer', label: 'Whole number' },
  { id: 'decimal', label: '2 decimals' },
];
const LINE_TYPES = new Set(['line', 'area', 'stackedArea', 'combo']);
const CATEGORY_COLOR_TYPES = new Set(['pie', 'doughnut', 'treemap']);
const VARY_TYPES = new Set(['column', 'bar', 'funnel']);

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Chart fields the user has touched. `undefined` means "auto" — derived
// from the current result each time, so changing the query re-picks
// sensible fields until the user takes over that particular one.
// `null` for category/seriesBy/size means an explicit "none".
function chartStateFromStored(stored) {
  if (!stored) return { type: undefined, category: undefined, values: undefined, seriesBy: undefined, size: undefined, title: '', xAxisTitle: '', yAxisTitle: '' };
  return {
    type: stored.type || undefined,
    category: stored.category === undefined ? undefined : stored.category,
    values: Array.isArray(stored.values) && stored.values.length ? stored.values : undefined,
    seriesBy: stored.seriesBy === undefined ? undefined : stored.seriesBy,
    size: stored.size === undefined ? undefined : stored.size,
    title: stored.title || '',
    xAxisTitle: stored.xAxisTitle || '',
    yAxisTitle: stored.yAxisTitle || '',
  };
}

// The chart engine's own pick for an arbitrary result, as a stored spec.
function heuristicStored(result) {
  const info = analyzeChartColumns(result.columns, result.rows);
  const h = heuristicChartSpec(info, result.rows.length);
  if (h.error) return {};
  const name = i => (i >= 0 ? info[i].name : null);
  return { type: h.type, category: name(h.category), values: h.values.map(v => info[v].name), seriesBy: name(h.seriesBy ?? -1), size: name(h.size ?? -1) };
}

// Turns a result + the user's chart fields into the stored (name-based)
// chartSpec. Visual mode knows its own column layout (group, [split],
// measure), so it maps fields explicitly instead of guessing.
function storedSpecFor(result, chartState, style, visualLayout) {
  if (!result || result.error || !result.columns || !result.rows || !result.rows.length) return null;
  const cols = result.columns;
  const heuristic = heuristicStored(result);
  const auto = !visualLayout
    ? heuristic
    : {
      type: heuristic.type || 'column',
      category: visualLayout.grouped ? cols[0] : null,
      seriesBy: visualLayout.grouped && visualLayout.split ? cols[1] : null,
      values: [cols[cols.length - 1]],
      size: null,
    };
  const has = name => name === null || cols.includes(name);
  const pick = key => (chartState[key] !== undefined && has(chartState[key]) ? chartState[key] : auto[key]);
  return {
    type: chartState.type || auto.type,
    category: pick('category'),
    seriesBy: pick('seriesBy'),
    size: pick('size'),
    values: chartState.values && chartState.values.every(has) ? chartState.values : auto.values,
    title: chartState.title,
    xAxisTitle: chartState.xAxisTitle,
    yAxisTitle: chartState.yAxisTitle,
    style,
  };
}

function initialEditorState(tile, draft, schema) {
  // An AI draft that targets an existing tile opens that tile's editor with
  // the suggested change applied, so saving updates it in place.
  const source = draft || tile;
  const base = {
    chart: chartStateFromStored(source && source.chartSpec),
    style: { ...DEFAULT_STYLE, ...((source && source.chartSpec && source.chartSpec.style) || {}) },
    appearance: { ...DEFAULT_APPEARANCE, ...((source && source.appearance) || {}) },
  };
  if (source && source.source && source.source.mode === 'visual' && source.source.visual) {
    const visual = reconcileVisual(source.source.visual, schema);
    if (visual) return { ...base, mode: 'visual', visual, sql: source.sql };
  }
  if (source) return { ...base, mode: 'sql', visual: defaultVisual(schema[0]), sql: source.sql || '' };
  return { ...base, mode: 'visual', visual: defaultVisual(schema[0]), sql: '' };
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

function Toggle({ label, checked, onChange, hint }) {
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <input type="checkbox" className="switch" checked={checked} onChange={e => onChange(e.target.checked)} />
    </label>
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

function TypeGallery({ info, rowCount, value, onChange }) {
  return (
    <div className="type-gallery">
      {CHART_TYPE_GROUPS.map(group => (
        <div key={group} className="type-group">
          <div className="type-group-label">{group}</div>
          <div className="chart-type-grid" role="radiogroup" aria-label={`${group} charts`}>
            {CHART_TYPES.filter(t => t.group === group).map(t => {
              const allowed = info ? chartTypeAllowed(t.id, info, rowCount) : true;
              const active = value === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={t.label}
                  className={`chart-type-btn${active ? ' is-active' : ''}`}
                  disabled={!info || !allowed}
                  title={!allowed ? `${t.label}: ${chartTypeHint(t.id)}` : t.label}
                  onClick={() => onChange(t.id)}
                >
                  <i className={`ph ${t.icon}`} aria-hidden="true" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TileEditor({ tile, draft, schema, schemaVersion, previewMode, onSave, onClose, initialPanel }) {
  const initial = useMemo(() => initialEditorState(tile, draft, schema), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState(initial.mode);
  const [visual, setVisual] = useState(initial.visual);
  const [sqlText, setSqlText] = useState(initial.sql);
  const [ranSql, setRanSql] = useState(initial.mode === 'sql' ? initial.sql : '');
  const [sqlBaseline, setSqlBaseline] = useState(initial.mode === 'sql' ? null : '');
  const [confirmVisualSwitch, setConfirmVisualSwitch] = useState(false);
  const [chartState, setChartState] = useState(initial.chart);
  const [style, setStyleState] = useState(initial.style);
  const [appearance, setAppearanceState] = useState(initial.appearance);
  const [panel, setPanel] = useState(initialPanel || 'data');
  const [previewTab, setPreviewTab] = useState('chart');
  const [saveError, setSaveError] = useState('');
  const dialogRef = useRef(null);

  const table = visual ? schema.find(t => t.name === visual.table) : null;
  const generatedSql = useMemo(() => buildVisualSql(visual, schema), [visual, schema]);
  const debouncedGenerated = useDebounced(generatedSql, 180);
  const activeSql = mode === 'visual' ? debouncedGenerated : ranSql;
  const visualLayout = mode === 'visual' && visual ? { grouped: !!visual.groupBy, split: !!(visual.groupBy && visual.splitBy) } : null;

  const result = useMemo(() => (activeSql.trim() ? runTileQuery(activeSql) : null), [activeSql, schemaVersion]);
  const storedSpec = useMemo(() => storedSpecFor(result, chartState, style, visualLayout), [result, chartState, style, visualLayout && visualLayout.grouped, visualLayout && visualLayout.split]); // eslint-disable-line react-hooks/exhaustive-deps
  const chart = useMemo(() => chartFromResult(result, storedSpec), [result, storedSpec]);
  const sqlDirty = mode === 'sql' && sqlText.trim() !== ranSql.trim();
  const overrides = useMemo(() => surfaceOverrides(appearance.background), [appearance.background]);

  // A query change that drops a column the user had pinned a field to hands
  // that field back to auto.
  const columnsKey = result && result.columns ? result.columns.join('\u0001') : '';
  useEffect(() => {
    if (!result || !result.columns) return;
    const cols = new Set(result.columns);
    setChartState(s => {
      const next = { ...s };
      ['category', 'seriesBy', 'size'].forEach(k => { if (s[k] !== undefined && s[k] !== null && !cols.has(s[k])) next[k] = undefined; });
      if (s.values && s.values.some(v => !cols.has(v))) next.values = undefined;
      return ['category', 'seriesBy', 'size', 'values'].every(k => next[k] === s[k]) ? s : next;
    });
  }, [columnsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = dialogRef.current;
    const first = el && el.querySelector('.editor-tabs .segmented-btn.is-active');
    if (first) first.focus();
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateVisual = patch => setVisual(v => ({ ...v, ...patch }));
  const setChart = patch => setChartState(s => ({ ...s, ...patch }));
  const setStyle = patch => setStyleState(s => ({ ...s, ...patch }));
  const setAppearance = patch => setAppearanceState(s => ({ ...s, ...patch }));

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
    setChart({ category: undefined, values: undefined, seriesBy: undefined, size: undefined });
  };

  const save = () => {
    setSaveError('');
    const finalSql = mode === 'visual' ? generatedSql : sqlText;
    if (!finalSql.trim()) { setSaveError('Build or write a query first.'); return; }
    const res = runTileQuery(finalSql);
    const spec = storedSpecFor(res, chartState, style, visualLayout);
    const check = chartFromResult(res, spec);
    if (check.error) {
      if (mode === 'sql') setRanSql(sqlText);
      setSaveError(check.kind === 'query' ? `The query failed: ${check.error}` : check.error);
      return;
    }
    const name = i => (i >= 0 && check.info[i] ? check.info[i].name : null);
    const s = check.spec;
    onSave({
      sql: finalSql.trim(),
      chartSpec: {
        type: s.type,
        title: chartState.title.trim(),
        category: name(s.category),
        values: s.type === 'table' ? (chartState.values || []) : s.values.map(v => check.info[v].name),
        seriesBy: name(s.seriesBy ?? -1),
        size: name(s.size ?? -1),
        xAxisTitle: chartState.xAxisTitle.trim(),
        yAxisTitle: chartState.yAxisTitle.trim(),
        style: cleanStyle(style),
      },
      appearance: cleanAppearance(appearance),
      source: mode === 'visual' ? { mode: 'visual', visual } : { mode: 'sql' },
    });
  };

  // ---- derived for the Visual & Format panels ----
  const info = chart.info || null;
  const spec = chart.spec || null;
  const rowCount = result && result.rows ? result.rows.length : 0;
  const type = spec ? spec.type : chartState.type;
  const isPie = type === 'pie' || type === 'doughnut';
  const maxSeries = spec ? maxValuesFor(spec.type, spec.seriesBy) : 6;
  const numericCols = info ? info.filter(c => c.kind === 'numeric' && (!spec || (c.index !== spec.category && c.index !== spec.seriesBy))) : [];
  const toggleValue = name => {
    const current = spec ? spec.values.map(v => info[v].name) : [];
    const next = current.includes(name) ? current.filter(n => n !== name) : [...current, name].slice(-Math.max(1, maxSeries));
    if (next.length) setChart({ values: next });
  };
  const toggleTableColumn = name => {
    const all = info ? info.map(c => c.name) : [];
    const current = chartState.values && chartState.values.length ? chartState.values : all;
    const next = current.includes(name) ? current.filter(n => n !== name) : all.filter(n => current.includes(n) || n === name);
    if (next.length) setChart({ values: next.length === all.length ? undefined : next });
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
  const displayTitle = chartState.title || (spec && spec.title) || 'Untitled tile';

  // Color rows: one per series, or one per category for charts that color
  // each slice/bar individually.
  const effectiveTheme = applyChartStyle(getChartTheme(previewMode), style);
  const colorByCategory = spec && (CATEGORY_COLOR_TYPES.has(spec.type) || (style.varyColors && VARY_TYPES.has(spec.type) && chart.data && chart.data.series && chart.data.series.length === 1));
  const colorLabels = !chart.data ? [] : colorByCategory
    ? (chart.data.categories || []).slice(0, 12)
    : chart.data.series ? chart.data.series.map(s => s.name) : [];
  const setColor = (i, c) => {
    const colors = [...(style.colors || [])];
    colors[i] = c;
    setStyle({ colors });
  };

  const titleId = useId();

  return createPortal(
    <div className="tile-editor-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tile-editor" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
        <header className="tile-editor-header">
          <h2 id={titleId}>{tile && draft ? 'Review the suggested change' : tile ? 'Edit tile' : draft ? 'Review the suggested tile' : 'Add a tile'}</h2>
          <div className="editor-tabs">
            <Segmented
              label="Editor panel"
              value={panel}
              onChange={setPanel}
              options={[
                { id: 'data', label: 'Data', icon: 'ph-database' },
                { id: 'visual', label: 'Visual', icon: 'ph-chart-bar' },
                { id: 'format', label: 'Format', icon: 'ph-palette' },
              ]}
            />
          </div>
          <button type="button" className="btn btn-icon tile-editor-close" onClick={onClose} aria-label="Close"><i className="ph ph-x" aria-hidden="true" /></button>
        </header>

        {draft && draft.note && <div className="draft-note"><i className="ph ph-sparkle" aria-hidden="true" /> {draft.note}</div>}

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
          <section className="tile-editor-config" aria-label="Tile settings">
            {panel === 'data' && (
              <>
                <div className="build-mode-row">
                  <span className="field-label">Build the query</span>
                  <Segmented
                    size="sm"
                    label="Build mode"
                    value={mode}
                    onChange={switchMode}
                    options={[
                      { id: 'visual', label: 'Visual', icon: 'ph-sliders-horizontal' },
                      { id: 'sql', label: 'SQL', icon: 'ph-code' },
                    ]}
                  />
                </div>
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
                            updateVisual({ groupBy: e.target.value, dateGrain: col && col.isoDate ? 'month' : 'none', splitBy: visual.splitBy === e.target.value ? '' : visual.splitBy });
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

                    {visual.groupBy && (
                      <Field label="Split by (legend)" hint="One series per value — stacked, grouped, or one line each.">
                        {id => (
                          <select id={id} className="select" value={visual.splitBy || ''} onChange={e => updateVisual({ splitBy: e.target.value })}>
                            <option value="">No split</option>
                            {table && <ColumnOptions columns={table.columns} filter={c => c.name !== visual.groupBy && c.kind !== 'numeric'} />}
                          </select>
                        )}
                      </Field>
                    )}

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
                <button type="button" className="btn btn-secondary btn-sm panel-next" onClick={() => setPanel('visual')}>Next: pick a visual <i className="ph ph-arrow-right" aria-hidden="true" /></button>
              </>
            )}

            {panel === 'visual' && (
              <div className="chart-settings">
                <TypeGallery info={info} rowCount={rowCount} value={type} onChange={t => setChart({ type: t })} />

                {spec && info && spec.type !== 'table' && (
                  <div className="field-wells">
                    {!['kpi', 'gauge', 'histogram'].includes(spec.type) && (
                      <Field label={isPie || spec.type === 'treemap' || spec.type === 'funnel' ? 'Slices / groups' : spec.type === 'scatter' || spec.type === 'bubble' ? 'X axis' : 'Categories (axis)'}>
                        {id => (
                          <select id={id} className="select" value={spec.category >= 0 ? info[spec.category].name : ''} onChange={e => setChart({ category: e.target.value === '' ? null : e.target.value })}>
                            {spec.type !== 'scatter' && spec.type !== 'bubble' && <option value="">(row number)</option>}
                            {(spec.type === 'scatter' || spec.type === 'bubble' ? info.filter(c => c.kind === 'numeric') : info).map(c => <option key={c.index} value={c.name}>{c.name}</option>)}
                          </select>
                        )}
                      </Field>
                    )}
                    <div className="field">
                      <span className="field-label">{maxSeries === 1 ? 'Value' : `Values (up to ${maxSeries})`}</span>
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
                    {supportsSeriesBy(spec.type) && (
                      <Field label="Split by (legend)" hint={spec.seriesBy >= 0 ? 'One series per value, top 8 kept (the rest become “Other”).' : null}>
                        {id => (
                          <select id={id} className="select" value={spec.seriesBy >= 0 ? info[spec.seriesBy].name : ''} onChange={e => setChart({ seriesBy: e.target.value === '' ? null : e.target.value })}>
                            <option value="">No split</option>
                            {info.filter(c => c.index !== spec.category && !spec.values.includes(c.index) && (c.kind !== 'numeric' || c.distinct <= 40)).map(c => <option key={c.index} value={c.name}>{c.name}</option>)}
                          </select>
                        )}
                      </Field>
                    )}
                    {spec.type === 'bubble' && (
                      <Field label="Bubble size">
                        {id => (
                          <select id={id} className="select" value={spec.size >= 0 ? info[spec.size].name : ''} onChange={e => setChart({ size: e.target.value || null })}>
                            {info.filter(c => c.kind === 'numeric' && c.index !== spec.category).map(c => <option key={c.index} value={c.name}>{c.name}</option>)}
                          </select>
                        )}
                      </Field>
                    )}
                    {spec.type === 'gauge' && <p className="field-hint">The gauge's maximum is the second value column if you pick one (e.g. a target), otherwise a round number above the value.</p>}
                    {spec.type === 'kpi' && <p className="field-hint">One row shows that value. Several rows grouped by a date show the latest value, its change from the one before, and a sparkline.</p>}
                    {!['pie', 'doughnut', 'treemap', 'funnel', 'kpi', 'gauge', 'heatmap'].includes(spec.type) && (
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
                  </div>
                )}
                {spec && info && spec.type === 'table' && (
                  <div className="field">
                    <span className="field-label">Columns</span>
                    <div className="value-chips">
                      {info.map(c => {
                        const on = !chartState.values || !chartState.values.length || chartState.values.includes(c.name);
                        return (
                          <button key={c.index} type="button" className={`value-chip${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => toggleTableColumn(c.name)}>
                            {on && <i className="ph ph-check" aria-hidden="true" />} {c.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <button type="button" className="btn btn-secondary btn-sm panel-next" onClick={() => setPanel('format')}>Next: colors &amp; format <i className="ph ph-arrow-right" aria-hidden="true" /></button>
              </div>
            )}

            {panel === 'format' && (
              <div className="format-panel">
                <section className="format-section">
                  <h3>Tile</h3>
                  <Field label="Title">
                    {id => <input id={id} className="text-input text-input-sm" value={chartState.title} placeholder={spec ? spec.title : 'Untitled tile'} onChange={e => setChart({ title: e.target.value })} />}
                  </Field>
                  <Field label="Subtitle">
                    {id => <input id={id} className="text-input text-input-sm" value={appearance.subtitle} placeholder="Optional — e.g. a source or date range" onChange={e => setAppearance({ subtitle: e.target.value })} />}
                  </Field>
                  <Toggle label="Show title" checked={appearance.showTitle} onChange={v => setAppearance({ showTitle: v })} />
                  <div className="field-row">
                    <div className="field">
                      <span className="field-label">Title size</span>
                      <Segmented size="sm" label="Title size" value={appearance.titleSize} onChange={v => setAppearance({ titleSize: v })} options={[{ id: 'sm', label: 'S' }, { id: 'md', label: 'M' }, { id: 'lg', label: 'L' }, { id: 'xl', label: 'XL' }]} />
                    </div>
                    <div className="field">
                      <span className="field-label">Align</span>
                      <Segmented size="sm" label="Title alignment" value={appearance.titleAlign} onChange={v => setAppearance({ titleAlign: v })} options={[{ id: 'left', label: '', icon: 'ph-text-align-left', ariaLabel: 'Left' }, { id: 'center', label: '', icon: 'ph-text-align-center', ariaLabel: 'Center' }, { id: 'right', label: '', icon: 'ph-text-align-right', ariaLabel: 'Right' }]} />
                    </div>
                  </div>
                  <div className="field">
                    <span className="field-label">Background</span>
                    <SwatchPicker label="Tile background" value={appearance.background || '#ffffff'} onChange={c => setAppearance({ background: c === '#ffffff' ? '' : c })} />
                  </div>
                  <div className="field">
                    <span className="field-label">Title color</span>
                    <SwatchPicker label="Title color" value={appearance.titleColor || ''} allowTransparent={false} onChange={c => setAppearance({ titleColor: c })} />
                  </div>
                  <Toggle label="Outline" checked={appearance.border} onChange={v => setAppearance({ border: v })} />
                </section>

                <section className="format-section">
                  <h3>Colors</h3>
                  <Field label="Palette">
                    {id => (
                      <select id={id} className="select" value={style.palette || ''} onChange={e => setStyle({ palette: e.target.value || null, colors: [] })}>
                        <option value="">Synth green (default)</option>
                        {Object.entries(PALETTES).filter(([k]) => k !== 'synth').map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                      </select>
                    )}
                  </Field>
                  <div className="palette-strip" aria-hidden="true">
                    {effectiveTheme.series.slice(0, 8).map((c, i) => <span key={i} style={{ background: c }} />)}
                  </div>
                  {colorLabels.length > 0 && (
                    <div className="color-rows">
                      {colorLabels.map((label, i) => (
                        <label key={`${label}-${i}`} className="color-row">
                          <input type="color" value={effectiveTheme.series[i % effectiveTheme.series.length]} onChange={e => setColor(i, e.target.value)} aria-label={`Color for ${label}`} />
                          <span className="color-row-label">{label}</span>
                          {style.colors && style.colors[i] && <button type="button" className="link-btn" onClick={() => setColor(i, null)}>Reset</button>}
                        </label>
                      ))}
                    </div>
                  )}
                  {spec && VARY_TYPES.has(spec.type) && chart.data && chart.data.series && chart.data.series.length === 1 && (
                    <Toggle label="Vary colors by category" checked={!!style.varyColors} onChange={v => setStyle({ varyColors: v })} />
                  )}
                  {style.colors && style.colors.some(Boolean) && <button type="button" className="link-btn" onClick={() => setStyle({ colors: [] })}>Reset all colors</button>}
                </section>

                <section className="format-section">
                  <h3>Chart</h3>
                  <div className="field">
                    <span className="field-label">Data labels</span>
                    <Segmented size="sm" label="Data labels" value={style.dataLabels} onChange={v => setStyle({ dataLabels: v })} options={[{ id: 'auto', label: 'Auto' }, { id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]} />
                  </div>
                  <Toggle label="Legend" checked={style.legend !== false} onChange={v => setStyle({ legend: v })} />
                  <Toggle label="Gridlines" checked={style.gridlines !== false} onChange={v => setStyle({ gridlines: v })} />
                  {spec && LINE_TYPES.has(spec.type) && <Toggle label="Smooth lines" checked={!!style.smooth} onChange={v => setStyle({ smooth: v })} />}
                  <Field label="Number format">
                    {id => (
                      <select id={id} className="select" value={style.format || 'auto'} onChange={e => setStyle({ format: e.target.value })}>
                        {NUMBER_FORMATS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                      </select>
                    )}
                  </Field>
                </section>
              </div>
            )}
          </section>

          <section className="tile-editor-preview" aria-label="Preview">
            <div className="preview-head">
              <span className="preview-label">Preview</span>
              {result && !result.error && result.rows && result.rows.length > 0 && (
                <Segmented size="sm" label="Preview as" value={previewTab} onChange={setPreviewTab} options={[{ id: 'chart', label: 'Chart' }, { id: 'data', label: 'Data' }]} />
              )}
            </div>
            <div className="preview-card">
              <TileFrame title={displayTitle} appearance={appearance} dragHandle={false}>
                <div className="tile-chart">
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
                    <ChartCanvas spec={chart.spec} data={chart.data} previewMode={previewMode} compact={false} themeOverrides={overrides} />
                  )}
                </div>
              </TileFrame>
            </div>
            {result && result.rows && (
              <p className="preview-meta">
                {result.rows.length.toLocaleString()}{result.truncated ? '+' : ''} row{result.rows.length === 1 ? '' : 's'} · {result.columns.length} column{result.columns.length === 1 ? '' : 's'}
                {chart.data && chart.data.shown < chart.data.total && !chart.data.pivoted && !chart.data.kpi ? ` · charting the first ${chart.data.shown.toLocaleString()}` : ''}
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

// Only persist style/appearance keys that differ from the defaults, so
// stored tiles stay small and pick up future default changes.
function cleanStyle(style) {
  const out = {};
  Object.entries(style).forEach(([k, v]) => {
    if (k === 'colors') { if (v && v.some(Boolean)) out.colors = v.map(c => c || null); return; }
    if (v !== DEFAULT_STYLE[k] && v !== undefined) out[k] = v;
  });
  return Object.keys(out).length ? out : undefined;
}

function cleanAppearance(appearance) {
  const out = {};
  Object.entries(appearance).forEach(([k, v]) => { if (v !== DEFAULT_APPEARANCE[k] && v !== undefined) out[k] = v; });
  return Object.keys(out).length ? out : undefined;
}
