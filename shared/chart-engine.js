// shared/chart-engine.js — the framework-agnostic core of synth-sql's
// charts.js: analyzeChartColumns(), heuristicChartSpec(), buildChartData(),
// and the SVG renderers. These are pure functions (spec + data + theme ->
// SVG string) with no DOM dependency beyond string building, so this one
// module is importable both ways:
//
//   - the vanilla shell, via a plain <script type="module"> tag (e.g. the
//     home view's miniature dashboard thumbnails, the dashboard image export)
//   - the dashboard/ React island's Vite build, via a normal ES import,
//     wrapped in a thin <Tile> component that sets the returned SVG string
//     as its content
//
// One engine, one set of chart-rendering bugs to fix, both consumers share
// it. AI chart-spec work stays out of here — that's chat.js's job, this
// module only turns a spec into pixels.
//
// What changed from synth-sql's charts.js (its 7 types and their geometry
// are ported as-is; everything else is additive):
//   - Theme is a parameter (shared/chart-themes.js) instead of a CSS
//     lookup, so the Power BI/Tableau preview skins (§8a, v1.1) reuse it.
//   - Styling lives on the spec: spec.style = { palette, colors[],
//     varyColors, legend, dataLabels, gridlines, smooth, format }. Palettes
//     are named presets (PALETTES); `colors` overrides individual series.
//   - 22 visual types (CHART_TYPES) — synth-sql's 7 plus stacked / 100%
//     stacked, combo (secondary axis), waterfall, stacked area, treemap,
//     funnel, bubble, histogram, heatmap, radar, KPI card, gauge, and table.
//   - spec.seriesBy ("split by", Power BI's Legend well): pivots long rows
//     (category, series, value) into one series per distinct value.
//   - spec.size: the bubble-size column.
//   - Tiles persist specs by column *name* (resolveChartSpec /
//     serializeChartSpec), so editing a tile's SQL can't swap its axes.
//
// A chart "spec" at render time (indexes into the result's columns):
//   { type, title, category, values, seriesBy, size, xAxisTitle, yAxisTitle, style }
// category/seriesBy/size = -1 when unused. xAxisTitle always names the
// category axis and yAxisTitle the value axis, however the chart is oriented.

export const CHART_TYPES = [
  // Compare
  { id: 'column', label: 'Column', group: 'Compare', icon: 'ph-chart-bar', pivot: true },
  { id: 'bar', label: 'Bar', group: 'Compare', icon: 'ph-chart-bar-horizontal', pivot: true },
  { id: 'stackedColumn', label: 'Stacked column', group: 'Compare', icon: 'ph-stack', pivot: true },
  { id: 'stackedBar', label: 'Stacked bar', group: 'Compare', icon: 'ph-rows', pivot: true },
  { id: 'percentColumn', label: '100% column', group: 'Compare', icon: 'ph-percent', pivot: true },
  { id: 'percentBar', label: '100% bar', group: 'Compare', icon: 'ph-columns', pivot: true },
  { id: 'combo', label: 'Column + line', group: 'Compare', icon: 'ph-chart-line-up' },
  { id: 'waterfall', label: 'Waterfall', group: 'Compare', icon: 'ph-steps' },
  // Trend
  { id: 'line', label: 'Line', group: 'Trend', icon: 'ph-chart-line', pivot: true },
  { id: 'area', label: 'Area', group: 'Trend', icon: 'ph-trend-up', pivot: true },
  { id: 'stackedArea', label: 'Stacked area', group: 'Trend', icon: 'ph-stack', pivot: true },
  // Part of a whole
  { id: 'pie', label: 'Pie', group: 'Part of a whole', icon: 'ph-chart-pie' },
  { id: 'doughnut', label: 'Doughnut', group: 'Part of a whole', icon: 'ph-chart-donut' },
  { id: 'treemap', label: 'Treemap', group: 'Part of a whole', icon: 'ph-squares-four' },
  { id: 'funnel', label: 'Funnel', group: 'Part of a whole', icon: 'ph-funnel' },
  // Distribution & relationship
  { id: 'scatter', label: 'Scatter', group: 'Relationship', icon: 'ph-chart-scatter' },
  { id: 'bubble', label: 'Bubble', group: 'Relationship', icon: 'ph-circles-three' },
  { id: 'histogram', label: 'Histogram', group: 'Relationship', icon: 'ph-chart-bar' },
  { id: 'heatmap', label: 'Heatmap', group: 'Relationship', icon: 'ph-grid-nine', pivot: true },
  { id: 'radar', label: 'Radar', group: 'Relationship', icon: 'ph-chart-polar', pivot: true },
  // Single value & detail
  { id: 'kpi', label: 'KPI card', group: 'Single value', icon: 'ph-number-square-one' },
  { id: 'gauge', label: 'Gauge', group: 'Single value', icon: 'ph-gauge' },
  { id: 'table', label: 'Table', group: 'Single value', icon: 'ph-table' },
];
export const CHART_TYPE_IDS = CHART_TYPES.map(t => t.id);
export const CHART_TYPE_GROUPS = [...new Set(CHART_TYPES.map(t => t.group))];
const TYPE = Object.fromEntries(CHART_TYPES.map(t => [t.id, t]));

export const MAX_SERIES = 6;
export const MAX_SCATTER_SERIES = 3;
export const MAX_PIE_SLICES = 6;
export const MAX_PIVOT_SERIES = 8;
export const MAX_POINTS = {
  column: 50, bar: 60, stackedColumn: 50, stackedBar: 60, percentColumn: 50, percentBar: 60, combo: 50, waterfall: 30,
  line: 1000, area: 1000, stackedArea: 1000, pie: MAX_PIE_SLICES, doughnut: MAX_PIE_SLICES, treemap: 40, funnel: 12,
  scatter: 2000, bubble: 500, histogram: 100000, heatmap: 40, radar: 12, kpi: 400, gauge: 1, table: 200,
};

const SINGLE_VALUE_TYPES = new Set(['pie', 'doughnut', 'treemap', 'funnel', 'waterfall', 'histogram', 'heatmap', 'kpi', 'bubble']);
const STACKED_TYPES = new Set(['stackedColumn', 'stackedBar', 'percentColumn', 'percentBar', 'stackedArea']);
const HORIZONTAL_TYPES = new Set(['bar', 'stackedBar', 'percentBar']);

// ---- Palettes ----
// 'synth' is the default: led by the brand lime (tokens.css --color-primary)
// and the forest ink, then the system's two tertiary accents. Everything
// else is a preset a tile can switch to; spec.style.colors overrides any
// single series on top of whichever palette is active.
export const PALETTES = {
  synth: { label: 'Synth green', colors: ['#9fe870', '#163300', '#38c8ff', '#ffc091', '#2ead4b', '#6b7a64', '#c5edab', '#054d28'] },
  forest: { label: 'Forest', colors: ['#163300', '#2ead4b', '#9fe870', '#054d28', '#c5edab', '#6b7a64', '#88b04b', '#3d5a1a'] },
  ocean: { label: 'Ocean', colors: ['#0b4f6c', '#38c8ff', '#01baef', '#20bf55', '#757575', '#0c7489', '#9ad1d4', '#034078'] },
  sunset: { label: 'Sunset', colors: ['#ff6b35', '#f7c59f', '#d62246', '#ffc091', '#4b1d3f', '#ffd11a', '#a72027', '#b86700'] },
  classic: { label: 'Classic', colors: ['#eb6834', '#2a78d6', '#1baf7a', '#4a3aa7', '#eda100', '#e87ba4', '#6b7a64', '#0e0f0c'] },
  powerbi: { label: 'Power BI', colors: ['#118dff', '#12239e', '#e66c37', '#6b007b', '#e044a7', '#744ec2', '#d9b300', '#d64550'] },
  tableau: { label: 'Tableau 10', colors: ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7'] },
  mono: { label: 'Monochrome', colors: ['#0e0f0c', '#454745', '#868685', '#b3b5b1', '#d3d6d0', '#2b2c29', '#6b6d69', '#a0a29e'] },
};

export const DEFAULT_STYLE = { palette: null, colors: [], varyColors: false, legend: true, dataLabels: 'auto', gridlines: true, smooth: false, format: 'auto' };

// Merges a spec's style into a theme: a named palette (plus per-series
// color overrides) replaces theme.series. With no palette named, the
// theme's own series are used — Synth green by default (tokens.css), and
// the v1.1 Power BI/Tableau preview skins' palettes once they exist.
export function applyChartStyle(theme, style) {
  const st = { ...DEFAULT_STYLE, ...(style || {}) };
  const base = PALETTES[st.palette] ? PALETTES[st.palette].colors : theme.series;
  const series = base.map((c, i) => (st.colors && st.colors[i]) || c);
  (st.colors || []).forEach((c, i) => { if (c && i >= series.length) series[i] = c; });
  return { ...theme, series };
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// "1,200", "$4.50", "(300)", "45%" all read as numbers; anything else is null.
export function parseChartNumber(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[,\s$€£¥%]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = parseFloat(s);
  return neg ? -n : n;
}

const DATE_RE = /^(\d{4}-\d{1,2}(-\d{1,2})?([ T].*)?|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}\/\d{1,2}(\/\d{1,2})?|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}|\d{4}-q[1-4]|q[1-4][ -]\d{4})$/i;

export function analyzeChartColumns(columns, rows) {
  const sample = rows.length > 5000 ? rows.slice(0, 5000) : rows;
  return columns.map((name, c) => {
    let nonEmpty = 0, numeric = 0, dates = 0, leadingZero = 0, yearLike = 0, totalLen = 0, absMax = 0;
    const distinct = new Set();
    for (const row of sample) {
      const v = row[c];
      if (v === null || v === undefined || v === '') continue;
      nonEmpty++;
      const s = String(v).trim();
      totalLen += s.length;
      if (distinct.size < 1000) distinct.add(s);
      const n = parseChartNumber(v);
      if (n !== null) {
        numeric++;
        if (Math.abs(n) > absMax) absMax = Math.abs(n);
        if (/^0\d/.test(s)) leadingZero++;
        if (Number.isInteger(n) && n >= 1900 && n <= 2100) yearLike++;
      } else if (DATE_RE.test(s)) {
        dates++;
      }
    }
    const lname = String(name).toLowerCase();
    const idLike = /(^|_|\b)id$|^id_|uuid|zip|postal|phone/.test(lname);
    let kind = 'text';
    if (nonEmpty > 0 && numeric >= 0.9 * nonEmpty && leadingZero === 0) kind = 'numeric';
    else if (nonEmpty > 0 && dates >= 0.9 * nonEmpty) kind = 'date';
    const temporal = kind === 'date' ||
      (kind === 'numeric' && yearLike === numeric && /(year|yr|fy|season)/.test(lname)) ||
      (kind === 'text' && /(month|week|quarter|date|day|period)/.test(lname));
    return { index: c, name: String(name), kind, temporal, idLike: kind === 'numeric' && idLike, distinct: distinct.size, nonEmpty, avgLen: nonEmpty ? totalLen / nonEmpty : 0, absMax };
  });
}

export function prettifyColumnName(name) {
  let s = String(name).trim().replace(/^["'`\[]|["'`\]]$/g, '');
  const agg = s.match(/^(sum|avg|average|count|min|max|total|median)\s*\(\s*(distinct\s+)?(.*?)\s*\)$/i);
  if (agg) {
    const fn = { sum: 'Total', total: 'Total', avg: 'Average', average: 'Average', count: 'Count', min: 'Minimum', max: 'Maximum', median: 'Median' }[agg[1].toLowerCase()];
    const inner = agg[3];
    if (!inner || inner === '*' || fn === 'Count') return inner && inner !== '*' ? `Count of ${prettifyColumnName(inner)}` : 'Count';
    return `${fn} ${prettifyColumnName(inner)}`;
  }
  const wrapped = s.match(/^(cast|round|replace|coalesce|abs|lower|upper|trim)\s*\(\s*([^,()]+)/i);
  if (wrapped) return prettifyColumnName(wrapped[2]);
  s = s.replace(/[_\-.]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  if (!s) return String(name);
  return s.split(' ').map(w => (w.length <= 3 && w === w.toUpperCase() && /[A-Z]/.test(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function numericCandidates(info, excludeIndex) {
  return info.filter(c => c.kind === 'numeric' && !c.idLike && c.index !== excludeIndex);
}

export function supportsSeriesBy(type) {
  return !!(TYPE[type] && TYPE[type].pivot);
}

export function maxValuesFor(type, seriesBy = -1) {
  if (type === 'table') return 0;
  if (seriesBy >= 0 && supportsSeriesBy(type)) return 1;
  if (type === 'scatter') return MAX_SCATTER_SERIES;
  if (type === 'gauge') return 2;
  if (SINGLE_VALUE_TYPES.has(type)) return 1;
  return MAX_SERIES;
}

// Forces a spec into something drawable for these columns: valid type,
// category, split-by, and numeric value columns within the type's limits.
export function normalizeChartSpec(spec, info, rowCount) {
  const s = { ...spec };
  const validIndex = i => Number.isInteger(i) && i >= 0 && i < info.length;
  if (!CHART_TYPE_IDS.includes(s.type)) s.type = 'column';
  if (!(Number.isInteger(s.category) && s.category >= -1 && s.category < info.length)) s.category = -1;
  s.seriesBy = validIndex(s.seriesBy) && s.seriesBy !== s.category ? s.seriesBy : -1;
  s.size = validIndex(s.size) ? s.size : -1;

  if (s.type === 'table') {
    s.values = (s.values || []).filter(v => validIndex(v));
    if (!s.title) s.title = 'Table';
    return s;
  }

  if ((s.type === 'scatter' || s.type === 'bubble') && (s.category < 0 || info[s.category].kind !== 'numeric')) {
    const x = info.find(c => c.kind === 'numeric' && !(s.values || []).includes(c.index) && !c.idLike);
    if (x) s.category = x.index; else s.type = 'column';
  }
  if (s.type === 'heatmap' && s.seriesBy < 0) {
    const second = info.find(c => c.kind !== 'numeric' && c.index !== s.category);
    if (second && s.category >= 0) s.seriesBy = second.index; else s.type = 'column';
  }
  if (!supportsSeriesBy(s.type)) s.seriesBy = -1;
  if (s.seriesBy >= 0 && info[s.seriesBy].kind === 'numeric' && info[s.seriesBy].distinct > 40) s.seriesBy = -1;

  let values = (s.values || []).filter((v, i, arr) => validIndex(v) && info[v].kind === 'numeric' && v !== s.category && v !== s.seriesBy && arr.indexOf(v) === i);
  if (!values.length) {
    const first = numericCandidates(info, s.category).find(c => c.index !== s.seriesBy) || info.find(c => c.kind === 'numeric' && c.index !== s.category && c.index !== s.seriesBy);
    if (first) values = [first.index];
  }
  if (s.type === 'combo' && values.length < 2) s.type = 'column';
  if (s.type === 'bubble') {
    if (!(s.size >= 0 && info[s.size].kind === 'numeric' && s.size !== s.category && !values.includes(s.size))) {
      const sz = info.find(c => c.kind === 'numeric' && !c.idLike && c.index !== s.category && !values.includes(c.index));
      if (sz) s.size = sz.index; else s.type = 'scatter';
    }
  }
  if (s.type !== 'bubble') s.size = -1;
  values = values.slice(0, Math.max(1, maxValuesFor(s.type, s.seriesBy)));
  s.values = values;

  if ((s.type === 'pie' || s.type === 'doughnut') && rowCount > MAX_PIE_SLICES) s.type = 'column';
  if (!s.title) s.title = defaultChartTitle(s, info);
  if (s.xAxisTitle === undefined) s.xAxisTitle = s.category >= 0 ? prettifyColumnName(info[s.category].name) : (s.type === 'histogram' ? prettifyColumnName(info[values[0]] ? info[values[0]].name : 'Value') : 'Row');
  if (s.yAxisTitle === undefined) s.yAxisTitle = s.type === 'histogram' ? 'Count' : values.length === 1 ? prettifyColumnName(info[values[0]].name) : 'Value';
  return s;
}

export function defaultChartTitle(s, info) {
  if (!s.values || !s.values.length) return 'Chart';
  const ys = s.values.map(v => prettifyColumnName(info[v].name));
  if (s.type === 'histogram') return `Distribution of ${ys[0]}`;
  const x = s.category >= 0 ? prettifyColumnName(info[s.category].name) : null;
  let yPart = ys.length <= 2 ? ys.join(' and ') : `${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]}`;
  if (yPart.length > 45) yPart = `${ys.slice(0, 2).join(', ')} and more`;
  if (s.type === 'scatter' || s.type === 'bubble') return `${yPart} vs. ${x}`;
  if (!x) return yPart;
  const split = s.seriesBy >= 0 ? ` and ${prettifyColumnName(info[s.seriesBy].name)}` : '';
  return `${yPart} by ${x}${split}`;
}

// One value axis only: a series 10x smaller than the lead series would
// flatten into the baseline, so auto-picked specs drop it. The user can
// still add it back by hand from the Values picker.
export function keepComparableSeries(values, info) {
  if (values.length < 2) return values;
  const lead = info[values[0]].absMax || 0;
  return values.filter((v, i) => i === 0 || !lead || (info[v].absMax >= lead / 10 && info[v].absMax <= lead * 10));
}

export function heuristicChartSpec(info, rowCount) {
  const temporal = info.find(c => c.temporal);
  const texts = info.filter(c => c.kind !== 'numeric');
  const nums = numericCandidates(info, -1);
  let spec;
  if (rowCount === 1 && nums.length >= 1 && texts.length === 0) {
    spec = { type: 'kpi', category: -1, values: [nums[0].index] };
  } else if (temporal) {
    const split = texts.find(c => c.index !== temporal.index && c.distinct <= MAX_PIVOT_SERIES * 2);
    spec = { type: 'line', category: temporal.index, seriesBy: split ? split.index : -1, values: numericCandidates(info, temporal.index).map(c => c.index) };
  } else if (texts.length) {
    const cat = texts[0];
    const split = texts[1] && texts[1].distinct <= MAX_PIVOT_SERIES * 2 ? texts[1] : null;
    let type = 'column';
    if (rowCount > MAX_POINTS.bar && !split) type = 'line';
    else if (rowCount > 15 || cat.avgLen > 14) type = split ? 'stackedBar' : 'bar';
    else if (split) type = 'stackedColumn';
    spec = { type, category: cat.index, seriesBy: split ? split.index : -1, values: numericCandidates(info, cat.index).map(c => c.index) };
  } else {
    if (nums.length >= 2 && rowCount > 1) spec = { type: 'scatter', category: nums[0].index, values: nums.slice(1).map(c => c.index) };
    else spec = { type: rowCount > MAX_POINTS.column ? 'line' : 'column', category: -1, values: nums.map(c => c.index) };
  }
  spec.values = keepComparableSeries(spec.values, info);
  const normalized = normalizeChartSpec(spec, info, rowCount);
  if (!normalized.values.length) {
    return { error: 'Charts need at least one numeric column to plot. Try an aggregate, e.g. SELECT category, COUNT(*) FROM your_table GROUP BY category — or pick the Table visual.' };
  }
  return normalized;
}

export function chartTypeAllowed(type, info, rowCount) {
  const numeric = info.filter(c => c.kind === 'numeric').length;
  if (type === 'table') return true;
  if (numeric === 0) return false;
  if (type === 'pie' || type === 'doughnut') return rowCount <= MAX_PIE_SLICES;
  if (type === 'scatter') return numeric >= 2;
  if (type === 'bubble') return numeric >= 3;
  if (type === 'combo') return numeric >= 2;
  if (type === 'heatmap') return info.filter(c => c.kind !== 'numeric').length >= 2;
  if (type === 'radar') return rowCount >= 3;
  return true;
}

export function chartTypeHint(type) {
  return {
    pie: `Needs ${MAX_PIE_SLICES} rows or fewer`, doughnut: `Needs ${MAX_PIE_SLICES} rows or fewer`,
    scatter: 'Needs 2 number columns', bubble: 'Needs 3 number columns (x, y, size)', combo: 'Needs 2 number columns',
    heatmap: 'Needs 2 text/date columns and a number', radar: 'Needs 3 or more rows',
  }[type] || 'Needs a number column';
}

// ---- Name-based specs (persistence / AI) ----
// Stored/AI shape: { type, title, category: <name|null>, values: [<name>],
// seriesBy: <name|null>, size: <name|null>, xAxisTitle, yAxisTitle, style }.
// Resolves to the index-based render spec for this particular result set,
// or falls back to the heuristic when the stored spec no longer fits.
// pruneIncomparable mirrors synth-sql's aiRawToSpec() for AI proposals.
export function resolveChartSpec(stored, info, rowCount, { pruneIncomparable = false } = {}) {
  if (!stored) return heuristicChartSpec(info, rowCount);
  const style = stored.style;
  const byName = name => {
    if (name === null || name === undefined || name === '') return -1;
    const exact = info.find(c => c.name === name);
    if (exact) return exact.index;
    const loose = info.find(c => c.name.toLowerCase() === String(name).toLowerCase());
    return loose ? loose.index : -2;
  };
  // A blank stored title means "auto" (the generated default), not "no title".
  const clean = t => typeof t === 'string' && t.trim() ? t.replace(/\s+/g, ' ').trim().slice(0, 90) : undefined;
  const type = CHART_TYPE_IDS.includes(stored.type) ? stored.type : 'column';
  const category = byName(stored.category);
  const seriesBy = byName(stored.seriesBy);
  const size = byName(stored.size);

  if (type === 'table') {
    return normalizeChartSpec({ type, category: -1, values: (stored.values || []).map(byName).filter(i => i >= 0), title: clean(stored.title), style }, info, rowCount);
  }
  const requested = (Array.isArray(stored.values) ? stored.values : []).map(byName).filter(i => i >= 0 && info[i].kind === 'numeric');
  const values = pruneIncomparable ? keepComparableSeries(requested, info) : requested;
  if (!values.length || category === -2) {
    const fallback = heuristicChartSpec(info, rowCount);
    if (!fallback.error) {
      if (clean(stored.title)) fallback.title = clean(stored.title);
      fallback.style = style;
    }
    return fallback;
  }
  const pruned = values.length !== requested.length;
  return normalizeChartSpec({
    type,
    category,
    seriesBy: seriesBy >= 0 ? seriesBy : -1,
    size: size >= 0 ? size : -1,
    values,
    title: pruned ? undefined : clean(stored.title),
    xAxisTitle: clean(stored.xAxisTitle),
    yAxisTitle: pruned ? undefined : clean(stored.yAxisTitle),
    style,
  }, info, rowCount);
}

export function serializeChartSpec(spec, info) {
  const name = i => (i >= 0 && info[i] ? info[i].name : null);
  return {
    type: spec.type,
    title: spec.title || '',
    category: name(spec.category),
    values: (spec.values || []).filter(v => info[v]).map(v => info[v].name),
    seriesBy: name(spec.seriesBy ?? -1),
    size: name(spec.size ?? -1),
    xAxisTitle: spec.xAxisTitle ?? '',
    yAxisTitle: spec.yAxisTitle ?? '',
    style: spec.style,
  };
}

// ---- Data prep ----
function categoryLabel(v) {
  return v === null || v === undefined || v === '' ? '(blank)' : String(v);
}

// Long rows (category, seriesBy, value) -> wide series. Series ranked by
// total, top MAX_PIVOT_SERIES kept, the rest folded into "Other".
function pivotData(spec, columns, rows, cap) {
  const vc = spec.values[0];
  const catOrder = [];
  const catIndex = new Map();
  const cells = new Map(); // `${cat}\u0001${ser}` -> sum
  const serTotals = new Map();
  for (const row of rows) {
    const cat = spec.category >= 0 ? categoryLabel(row[spec.category]) : '(all)';
    if (!catIndex.has(cat)) {
      if (catOrder.length >= cap) continue;
      catIndex.set(cat, catOrder.length);
      catOrder.push(cat);
    }
    const ser = categoryLabel(row[spec.seriesBy]);
    const v = parseChartNumber(row[vc]);
    if (v === null) continue;
    const key = `${cat}\u0001${ser}`;
    cells.set(key, (cells.get(key) || 0) + v);
    serTotals.set(ser, (serTotals.get(ser) || 0) + Math.abs(v));
  }
  const ranked = [...serTotals.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const kept = ranked.slice(0, MAX_PIVOT_SERIES);
  const other = ranked.slice(MAX_PIVOT_SERIES);
  const series = kept.map((name, i) => ({
    name, rawName: name, colorIndex: i,
    values: catOrder.map(cat => (cells.has(`${cat}\u0001${name}`) ? cells.get(`${cat}\u0001${name}`) : null)),
  }));
  if (other.length) {
    series.push({
      name: 'Other', rawName: 'Other', colorIndex: series.length,
      values: catOrder.map(cat => other.reduce((sum, name) => sum + (cells.get(`${cat}\u0001${name}`) || 0), 0)),
    });
  }
  return { series, categories: catOrder, total: rows.length, shown: rows.length, dropped: 0, pivoted: true, measureName: prettifyColumnName(columns[vc]) };
}

function histogramData(spec, columns, rows) {
  const vc = spec.values[0];
  const nums = [];
  for (const row of rows) { const v = parseChartNumber(row[vc]); if (v !== null) nums.push(v); }
  if (!nums.length) return { series: [{ name: 'Count', values: [], colorIndex: 0 }], categories: [], total: rows.length, shown: 0 };
  let lo = Infinity, hi = -Infinity;
  for (const n of nums) { if (n < lo) lo = n; if (n > hi) hi = n; }
  const target = Math.min(24, Math.max(5, Math.ceil(Math.sqrt(nums.length))));
  const scale = niceScale(lo, hi === lo ? lo + 1 : hi, target);
  const bins = [];
  for (let b = scale.lo; b < scale.hi - scale.step / 2; b += scale.step) bins.push(+b.toPrecision(12));
  const counts = bins.map(() => 0);
  for (const n of nums) {
    let i = Math.floor((n - scale.lo) / scale.step);
    if (i >= bins.length) i = bins.length - 1;
    if (i < 0) i = 0;
    counts[i]++;
  }
  const categories = bins.map(b => `${formatTick(b, scale.step)}–${formatTick(+(b + scale.step).toPrecision(12), scale.step)}`);
  return { series: [{ name: 'Count', rawName: 'count', colorIndex: 0, values: counts }], categories, total: rows.length, shown: nums.length, histogram: true };
}

export function buildChartData(spec, columns, rows) {
  const cap = MAX_POINTS[spec.type] || 50;
  if (spec.type === 'table') {
    const cols = spec.values && spec.values.length ? spec.values : columns.map((_, i) => i);
    return { table: { columns: cols.map(i => columns[i]), rows: rows.slice(0, cap).map(r => cols.map(i => r[i])) }, total: rows.length, shown: Math.min(rows.length, cap) };
  }
  if (spec.type === 'histogram') return histogramData(spec, columns, rows);
  if (spec.seriesBy >= 0 && supportsSeriesBy(spec.type)) return pivotData(spec, columns, rows, cap);

  const series = spec.values.map((vc, i) => ({ name: prettifyColumnName(columns[vc]), rawName: columns[vc], colorIndex: i }));
  if (spec.type === 'scatter' || spec.type === 'bubble') {
    const points = [];
    for (const row of rows) {
      const x = parseChartNumber(row[spec.category]);
      if (x === null) continue;
      points.push({ x, ys: spec.values.map(vc => parseChartNumber(row[vc])), size: spec.size >= 0 ? parseChartNumber(row[spec.size]) : null, label: row[0] });
      if (points.length >= cap) break;
    }
    return { series, points, total: rows.length, shown: points.length, sizeName: spec.size >= 0 ? prettifyColumnName(columns[spec.size]) : null };
  }
  if (spec.type === 'kpi' || spec.type === 'gauge') {
    const vc = spec.values[0];
    const vals = rows.slice(0, cap).map(r => parseChartNumber(r[vc])).filter(v => v !== null);
    let value, previous = null;
    if (spec.type === 'gauge' || rows.length === 1) value = vals[0] ?? null;
    else if (spec.category >= 0) { value = vals[vals.length - 1] ?? null; previous = vals.length > 1 ? vals[vals.length - 2] : null; }
    else value = vals.reduce((a, b) => a + b, 0);
    const target = spec.values[1] !== undefined && rows[0] ? parseChartNumber(rows[0][spec.values[1]]) : null;
    return {
      series, kpi: { value, previous, target, spark: rows.length > 1 ? vals : null, label: series[0] ? series[0].name : '', mode: rows.length === 1 ? 'single' : spec.category >= 0 ? 'latest' : 'total' },
      categories: [], total: rows.length, shown: rows.length,
    };
  }

  let used = rows.slice(0, cap);
  let dropped = 0;
  if (spec.type === 'pie' || spec.type === 'doughnut' || spec.type === 'treemap' || spec.type === 'funnel') {
    const before = used.length;
    used = used.filter(r => (parseChartNumber(r[spec.values[0]]) || 0) > 0);
    dropped = before - used.length;
  }
  const categories = used.map((row, i) => (spec.category < 0 ? String(i + 1) : categoryLabel(row[spec.category])));
  series.forEach(s => {
    const vc = spec.values[s.colorIndex];
    s.values = used.map(row => parseChartNumber(row[vc]));
  });
  return { series, categories, total: rows.length, shown: used.length, dropped };
}

export function chartDataIsEmpty(spec, data) {
  if (spec.type === 'table') return !data.table.columns.length;
  if (spec.type === 'kpi' || spec.type === 'gauge') return data.kpi.value === null || data.kpi.value === undefined;
  if (spec.type === 'scatter' || spec.type === 'bubble') return !data.points.length;
  return !data.categories.length;
}

// ---- Formatting ----
// The number format is a per-chart style choice; renders are synchronous,
// so the active format is set for the duration of one renderChartSVG call
// rather than threaded through every helper.
let activeFormat = 'auto';

function niceScale(min, max, count = 5) {
  if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
  if (min === max) {
    if (min === 0) max = 1;
    else { const pad = Math.abs(min) * 0.1; min -= pad; max += pad; }
  }
  const rough = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toPrecision(12));
  return { lo, hi: hi === lo ? lo + step : hi, ticks, step };
}

const compact = n => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

function formatTick(n, step) {
  if (activeFormat === 'percent') return `${(+n).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
  if (activeFormat === 'currency') return Math.abs(n) >= 10000 ? `$${compact(n)}` : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: step < 1 ? 2 : 0 });
  if (Math.abs(n) >= 10000 || activeFormat === 'compact') return compact(n);
  const decimals = step < 1 ? Math.min(4, Math.ceil(-Math.log10(step))) : 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatChartValue(n, format = activeFormat) {
  if (n === null || n === undefined) return '—';
  switch (format) {
    case 'currency': return Math.abs(n) >= 100000 ? `$${compact(n)}` : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
    case 'percent': return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
    case 'compact': return compact(n);
    case 'integer': return Math.round(n).toLocaleString('en-US');
    case 'decimal': return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    default:
      if (Math.abs(n) >= 100000) return compact(n);
      return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
}

const textW = (s, size) => String(s).length * size * 0.58;
const clip = (s, n) => { s = String(s); return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s; };
const f1 = n => (+n).toFixed(1);

// Rounded 4px data-end, square at the baseline.
function barPath(x, y, w, h, end, radius = 4) {
  if (w <= 0 || h <= 0) return '';
  const r = Math.min(radius, end === 'up' || end === 'down' ? w / 2 : h / 2, end === 'up' || end === 'down' ? h : w);
  if (end === 'none' || r <= 0) return `M${f1(x)},${f1(y)}H${f1(x + w)}V${f1(y + h)}H${f1(x)}Z`;
  if (end === 'up') return `M${f1(x)},${f1(y + h)}V${f1(y + r)}Q${f1(x)},${f1(y)} ${f1(x + r)},${f1(y)}H${f1(x + w - r)}Q${f1(x + w)},${f1(y)} ${f1(x + w)},${f1(y + r)}V${f1(y + h)}Z`;
  if (end === 'down') return `M${f1(x)},${f1(y)}V${f1(y + h - r)}Q${f1(x)},${f1(y + h)} ${f1(x + r)},${f1(y + h)}H${f1(x + w - r)}Q${f1(x + w)},${f1(y + h)} ${f1(x + w)},${f1(y + h - r)}V${f1(y)}Z`;
  if (end === 'right') return `M${f1(x)},${f1(y)}H${f1(x + w - r)}Q${f1(x + w)},${f1(y)} ${f1(x + w)},${f1(y + r)}V${f1(y + h - r)}Q${f1(x + w)},${f1(y + h)} ${f1(x + w - r)},${f1(y + h)}H${f1(x)}Z`;
  return `M${f1(x + w)},${f1(y)}H${f1(x + r)}Q${f1(x)},${f1(y)} ${f1(x)},${f1(y + r)}V${f1(y + h - r)}Q${f1(x)},${f1(y + h)} ${f1(x + r)},${f1(y + h)}H${f1(x + w)}Z`;
}

function svgText(x, y, str, { size = 11, fill, anchor = 'start', weight = 400, rotate = null, family = null, edit = null } = {}) {
  const t = rotate !== null ? ` transform="rotate(${rotate} ${f1(x)} ${f1(y)})"` : '';
  const ff = family ? ` font-family="${family}"` : '';
  const ed = edit ? ` class="chart-editable" data-edit="${edit}"` : '';
  return `<text x="${f1(x)}" y="${f1(y)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}"${ff}${t}${ed}>${escapeXml(String(str))}</text>`;
}

// Readable ink on top of a fill color.
function relativeLuminance(hex) {
  const c = String(hex).replace('#', '');
  if (c.length < 6) return 0.5;
  const [r, g, b] = [0, 2, 4].map(i => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const inkOn = (color, theme) => (relativeLuminance(color) > 0.35 ? (theme.text || '#0e0f0c') : '#ffffff');

function mixHex(a, b, t) {
  const pa = String(a).replace('#', ''), pb = String(b).replace('#', '');
  const ch = (p, i) => parseInt(p.slice(i, i + 2), 16);
  const out = [0, 2, 4].map(i => Math.round(ch(pa, i) + (ch(pb, i) - ch(pa, i)) * t).toString(16).padStart(2, '0'));
  return `#${out.join('')}`;
}

// A light lime line on white disappears; strokes of very light series
// colors are darkened a little so thin lines stay visible.
function strokeFor(color) {
  return relativeLuminance(color) > 0.55 ? mixHex(color, '#163300', 0.28) : color;
}

// Title + legend block; returns [svg, heightUsed].
function renderChartHeader(spec, theme, W, legendItems, options) {
  let out = '';
  let y;
  if (options.showTitle) {
    out = svgText(20, 32, clip(spec.title || 'Untitled chart', 100), { size: 17, fill: spec.title ? theme.text : theme.text2, weight: 600, edit: 'title' });
    y = 44;
  } else {
    y = 4;
  }
  if (options.legend && legendItems.length >= 2) {
    let x = 20;
    y += 14;
    legendItems.forEach(item => {
      const w = 16 + textW(item.label, 12) + 18;
      if (x + w > W - 20 && x > 20) { x = 20; y += 20; }
      out += `<rect x="${x}" y="${y - 9}" width="10" height="10" rx="2" fill="${item.color}"></rect>`;
      out += svgText(x + 16, y, clip(item.label, 28), { size: 12, fill: theme.text2 });
      x += w;
    });
    y += 6;
  }
  return [out, y + (options.showTitle ? 16 : 12)];
}

function linePath(pts, smooth) {
  if (!smooth || pts.length < 3) return pts.map((p, j) => `${j ? 'L' : 'M'}${f1(p[0])},${f1(p[1])}`).join('');
  let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f1(c1[0])},${f1(c1[1])} ${f1(c2[0])},${f1(c2[1])} ${f1(p2[0])},${f1(p2[1])}`;
  }
  return d;
}

// ---- Cartesian: column / bar (+ stacked, 100%), line / area (+ stacked),
// combo, histogram, scatter / bubble ----
function renderCartesianSVG(spec, data, theme, size, opts) {
  const W = size.width;
  const t = spec.type;
  const horizontal = HORIZONTAL_TYPES.has(t);
  const scatter = t === 'scatter' || t === 'bubble';
  const stacked = STACKED_TYPES.has(t);
  const percent = t === 'percentColumn' || t === 'percentBar';
  const combo = t === 'combo' && data.series.length > 1;
  const barLike = t === 'column' || t === 'histogram' || t === 'stackedColumn' || t === 'percentColumn' || combo;
  const nSeries = data.series.length;
  const color = (k, i) => (opts.varyColors && nSeries === 1 && !scatter ? theme.series[i % theme.series.length] : theme.series[k % theme.series.length]);
  const legend = data.series.map((s, i) => ({ label: s.name, color: theme.series[i % theme.series.length] }));
  const [header, top] = renderChartHeader(spec, theme, W, legend, opts);
  const labelsOn = opts.dataLabels === 'on';
  const labelsOff = opts.dataLabels === 'off';

  // Values as plotted: 100% charts re-express each category as shares.
  const plotted = data.series.map(s => ({ ...s, values: s.values ? [...s.values] : [] }));
  if (percent) {
    const n = data.categories.length;
    for (let i = 0; i < n; i++) {
      const total = plotted.reduce((sum, s) => sum + Math.abs(s.values[i] || 0), 0) || 1;
      plotted.forEach(s => { if (s.values[i] !== null) s.values[i] = (s.values[i] / total) * 100; });
    }
  }
  const prevFormat = activeFormat;
  if (percent) activeFormat = 'percent';

  let vMin, vMax;
  const primarySeries = combo ? plotted.slice(0, 1) : plotted;
  if (scatter) {
    const all = data.points.flatMap(p => p.ys).filter(v => v !== null);
    vMin = Math.min(...all); vMax = Math.max(...all);
  } else if (stacked) {
    vMin = 0; vMax = 0;
    for (let i = 0; i < data.categories.length; i++) {
      let pos = 0, neg = 0;
      plotted.forEach(s => { const v = s.values[i] || 0; if (v >= 0) pos += v; else neg += v; });
      vMax = Math.max(vMax, pos); vMin = Math.min(vMin, neg);
    }
  } else {
    const all = primarySeries.flatMap(s => s.values).filter(v => v !== null);
    vMin = Math.min(...all); vMax = Math.max(...all);
  }
  if (!isFinite(vMin) || !isFinite(vMax)) { vMin = 0; vMax = 1; }
  const forceZero = barLike || horizontal || t === 'area' || t === 'stackedArea' || (vMin >= 0 && vMin <= vMax * 0.5);
  if (forceZero) { vMin = Math.min(0, vMin); vMax = Math.max(0, vMax); }
  if (percent) { vMin = Math.min(vMin, 0); vMax = 100; }
  const vs = niceScale(vMin, vMax);
  const tickLabels = vs.ticks.map(tk => formatTick(tk, vs.step));

  let vs2 = null, tickLabels2 = [];
  if (combo) {
    const all2 = plotted.slice(1).flatMap(s => s.values).filter(v => v !== null);
    let lo2 = Math.min(...all2), hi2 = Math.max(...all2);
    if (!isFinite(lo2)) { lo2 = 0; hi2 = 1; }
    if (lo2 >= 0 && lo2 <= hi2 * 0.5) lo2 = 0;
    vs2 = niceScale(lo2, hi2);
    tickLabels2 = vs2.ticks.map(tk => formatTick(tk, vs2.step));
  }

  let out = '';
  const catTitle = spec.xAxisTitle, valTitle = spec.yAxisTitle;
  const gridStroke = tk => (tk === 0 ? theme.axis : opts.gridlines ? theme.grid : 'none');

  if (horizontal) {
    const n = data.categories.length;
    const catLabels = data.categories.map(c => clip(c, 22));
    const catLabelW = Math.max(...catLabels.map(l => textW(l, 11)), 10);
    const left = 20 + (catTitle ? 22 : 0) + catLabelW + 10;
    const tipLabels = !labelsOff && !stacked && nSeries === 1 && (n <= 30 || labelsOn);
    const tipW = tipLabels ? Math.max(...plotted[0].values.map(v => textW(formatChartValue(v), 10))) + 8 : 0;
    const right = W - 28 - tipW;
    const plotTop = top + 4;
    const footer = 26 + (valTitle ? 26 : 0) + 8;
    const perRow = stacked ? 1 : nSeries;
    const rowH = Math.max(24, perRow * 12 + 12, Math.min(48, (size.height - plotTop - footer) / Math.max(1, n)));
    const plotH = n * rowH;
    const bottom = plotTop + plotH;
    const H = bottom + footer;
    const sx = v => left + (v - vs.lo) / (vs.hi - vs.lo) * (right - left);
    vs.ticks.forEach((tk, i) => {
      const x = sx(tk);
      out += `<line x1="${f1(x)}" y1="${plotTop}" x2="${f1(x)}" y2="${bottom}" stroke="${gridStroke(tk)}" stroke-width="1"></line>`;
      out += svgText(x, bottom + 16, tickLabels[i], { size: 11, fill: theme.text2, anchor: 'middle' });
    });
    const thick = stacked ? Math.min(28, rowH * 0.72) : Math.min(24, (rowH * 0.72 - (nSeries - 1) * 2) / nSeries);
    data.categories.forEach((cat, i) => {
      const y0 = plotTop + i * rowH;
      let tip = `${cat}`;
      let bars = '';
      if (stacked) {
        let pos = 0, neg = 0;
        const y = y0 + (rowH - thick) / 2;
        plotted.forEach((s, k) => {
          const v = s.values[i];
          tip += `\n${s.name}: ${formatChartValue(percent ? v : data.series[k].values[i])}`;
          if (!v) return;
          const from = v >= 0 ? pos : neg;
          const to = from + v;
          if (v >= 0) pos = to; else neg = to;
          const x0 = sx(from), x1 = sx(to);
          bars += `<path class="chart-mark" d="${barPath(Math.min(x0, x1), y, Math.abs(x1 - x0), thick, 'none')}" fill="${color(k, i)}" stroke="${theme.surface}" stroke-width="1"></path>`;
          if (labelsOn && Math.abs(x1 - x0) > 34) bars += svgText((x0 + x1) / 2, y + thick / 2 + 4, formatChartValue(v), { size: 10, fill: inkOn(color(k, i), theme), anchor: 'middle' });
        });
      } else {
        const groupH = nSeries * thick + (nSeries - 1) * 2;
        plotted.forEach((s, k) => {
          const v = s.values[i];
          tip += `\n${s.name}: ${formatChartValue(v)}`;
          if (v === null) return;
          const y = y0 + (rowH - groupH) / 2 + k * (thick + 2);
          const x0 = sx(0), x1 = sx(v);
          bars += `<path class="chart-mark" d="${barPath(Math.min(x0, x1), y, Math.abs(x1 - x0), thick, v >= 0 ? 'right' : 'left')}" fill="${color(k, i)}"></path>`;
          if (tipLabels) out += svgText(v >= 0 ? x1 + 5 : x1 - 5, y + thick / 2 + 4, formatChartValue(v), { size: 10, fill: theme.text2, anchor: v >= 0 ? 'start' : 'end' });
        });
      }
      out += `<g><title>${escapeXml(tip)}</title><rect x="${left}" y="${f1(y0)}" width="${right - left}" height="${rowH}" fill="transparent"></rect>${bars}</g>`;
      out += svgText(left - 8, y0 + rowH / 2 + 4, catLabels[i], { size: 11, fill: theme.text2, anchor: 'end' });
    });
    out += `<line x1="${left}" y1="${plotTop}" x2="${left}" y2="${bottom}" stroke="${theme.axis}" stroke-width="1"></line>`;
    if (catTitle) out += svgText(28, plotTop + plotH / 2, catTitle, { size: 12, fill: theme.text2, anchor: 'middle', rotate: -90, weight: 500, edit: 'xAxisTitle' });
    if (valTitle) out += svgText((left + right) / 2, bottom + 44, valTitle, { size: 12, fill: theme.text2, anchor: 'middle', weight: 500, edit: 'yAxisTitle' });
    activeFormat = prevFormat;
    return wrapSvg(W, H, theme, header + out);
  }

  // Vertical layouts.
  const yLabelW = Math.max(...tickLabels.map(l => textW(l, 11)));
  const y2LabelW = combo ? Math.max(...tickLabels2.map(l => textW(l, 11))) + 14 : 0;
  const left = 20 + (valTitle ? 22 : 0) + yLabelW + 10;
  const right = W - 28 - y2LabelW;
  const plotW = right - left;
  let xLabelArea = 22, rotate = false, every = 1;
  let xs;
  let catLabels = [];
  if (scatter) {
    const xVals = data.points.map(p => p.x);
    xs = niceScale(Math.min(...xVals), Math.max(...xVals));
  } else {
    const n = data.categories.length;
    catLabels = data.categories.map(c => clip(c, 18));
    const band = plotW / Math.max(1, n);
    const maxLabelW = Math.max(...catLabels.map(l => textW(l, 11)), 1);
    if (maxLabelW > band - 6) {
      // Rotated -40deg labels need ~26px of horizontal room each to not
      // overlap; thin them to every Nth category past that.
      rotate = true;
      every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 26))));
      xLabelArea = Math.min(maxLabelW, textW('x'.repeat(18), 11)) * 0.66 + 22;
    }
  }
  const plotTop = top + 4;
  const H = Math.max(size.height, plotTop + opts.minPlotHeight + xLabelArea + (catTitle ? 28 : 0));
  const bottom = H - xLabelArea - (catTitle ? 28 : 0) - 10;
  const sy = v => bottom - (v - vs.lo) / (vs.hi - vs.lo) * (bottom - plotTop);
  const sy2 = vs2 ? v => bottom - (v - vs2.lo) / (vs2.hi - vs2.lo) * (bottom - plotTop) : sy;

  vs.ticks.forEach((tk, i) => {
    const y = sy(tk);
    out += `<line x1="${left}" y1="${f1(y)}" x2="${right}" y2="${f1(y)}" stroke="${gridStroke(tk)}" stroke-width="1"></line>`;
    out += svgText(left - 8, y + 4, tickLabels[i], { size: 11, fill: theme.text2, anchor: 'end' });
  });
  if (vs2) vs2.ticks.forEach((tk, i) => out += svgText(right + 8, sy2(tk) + 4, tickLabels2[i], { size: 11, fill: strokeFor(theme.series[1 % theme.series.length]), anchor: 'start' }));
  if (valTitle) out += svgText(28, (plotTop + bottom) / 2, valTitle, { size: 12, fill: theme.text2, anchor: 'middle', rotate: -90, weight: 500, edit: 'yAxisTitle' });
  if (catTitle) out += svgText((left + right) / 2, H - 14, catTitle, { size: 12, fill: theme.text2, anchor: 'middle', weight: 500, edit: 'xAxisTitle' });

  if (scatter) {
    const sx = v => left + (v - xs.lo) / (xs.hi - xs.lo) * plotW;
    xs.ticks.forEach(tk => {
      const x = sx(tk);
      if (opts.gridlines) out += `<line x1="${f1(x)}" y1="${plotTop}" x2="${f1(x)}" y2="${bottom}" stroke="${theme.grid}" stroke-width="1"></line>`;
      out += svgText(x, bottom + 16, formatTick(tk, xs.step), { size: 11, fill: theme.text2, anchor: 'middle' });
    });
    const maxSize = t === 'bubble' ? Math.max(...data.points.map(p => Math.abs(p.size || 0)), 1) : 1;
    data.points.forEach(p => {
      p.ys.forEach((y, k) => {
        if (y === null) return;
        const r = t === 'bubble' ? 4 + 22 * Math.sqrt(Math.abs(p.size || 0) / maxSize) : 4.5;
        const c = theme.series[k % theme.series.length];
        const tip = `${data.series[k].name}: ${formatChartValue(y)}\n${catTitle || 'X'}: ${formatChartValue(p.x)}${t === 'bubble' ? `\n${data.sizeName}: ${formatChartValue(p.size)}` : ''}`;
        out += `<circle class="chart-mark" cx="${f1(sx(p.x))}" cy="${f1(sy(y))}" r="${f1(r)}" fill="${c}" fill-opacity="${t === 'bubble' ? 0.7 : 1}" stroke="${t === 'bubble' || strokeFor(c) !== c ? strokeFor(c) : theme.surface}" stroke-width="${t === 'bubble' || strokeFor(c) !== c ? 1.2 : 2}"><title>${escapeXml(tip)}</title></circle>`;
      });
    });
    activeFormat = prevFormat;
    return wrapSvg(W, H, theme, header + out);
  }

  const n = data.categories.length;
  const band = plotW / Math.max(1, n);
  const cx = i => left + band * (i + 0.5);
  catLabels.forEach((label, i) => {
    if (i % every !== 0) return;
    out += rotate
      ? svgText(cx(i) + 3, bottom + 14, label, { size: 11, fill: theme.text2, anchor: 'end', rotate: -40 })
      : svgText(cx(i), bottom + 16, label, { size: 11, fill: theme.text2, anchor: 'middle' });
  });

  // Per-category hover band carrying every series' value.
  let hover = '';
  data.categories.forEach((cat, i) => {
    const tip = [cat, ...data.series.map(s => `${s.name}: ${formatChartValue(s.values[i])}`)].join('\n');
    hover += `<rect x="${f1(left + band * i)}" y="${plotTop}" width="${f1(band)}" height="${f1(bottom - plotTop)}" fill="transparent"><title>${escapeXml(tip)}</title></rect>`;
  });

  const drawColumns = (seriesList, scale) => {
    if (t === 'stackedColumn' || t === 'percentColumn') {
      const thick = Math.min(40, band * 0.72);
      for (let i = 0; i < n; i++) {
        let pos = 0, neg = 0;
        seriesList.forEach((s, k) => {
          const v = s.values[i];
          if (!v) return;
          const from = v >= 0 ? pos : neg;
          const to = from + v;
          if (v >= 0) pos = to; else neg = to;
          const y0 = scale(from), y1 = scale(to);
          const x = left + band * i + (band - thick) / 2;
          out += `<path class="chart-mark" d="${barPath(x, Math.min(y0, y1), thick, Math.abs(y1 - y0), 'none')}" fill="${color(k, i)}" stroke="${theme.surface}" stroke-width="1"></path>`;
          if (labelsOn && Math.abs(y1 - y0) > 16) out += svgText(x + thick / 2, (y0 + y1) / 2 + 4, formatChartValue(v), { size: 10, fill: inkOn(color(k, i), theme), anchor: 'middle' });
        });
      }
      return;
    }
    const k0 = seriesList.length;
    const gap = t === 'histogram' ? 0.96 : 0.72;
    const thick = t === 'histogram' ? band * gap : Math.min(24, (band * gap - (k0 - 1) * 2) / k0);
    const groupW = k0 * thick + (k0 - 1) * 2;
    seriesList.forEach((s, k) => {
      s.values.forEach((v, i) => {
        if (v === null) return;
        const x = left + band * i + (band - groupW) / 2 + k * (thick + 2);
        const y0 = scale(0), y1 = scale(v);
        out += `<path class="chart-mark" d="${barPath(x, Math.min(y0, y1), thick, Math.abs(y1 - y0), v >= 0 ? 'up' : 'down', t === 'histogram' ? 1 : 4)}" fill="${color(k, i)}"></path>`;
        const showLabel = labelsOn || (!labelsOff && k0 === 1 && n <= 20 && t !== 'histogram');
        if (showLabel) out += svgText(x + thick / 2, v >= 0 ? y1 - 6 : y1 + 14, formatChartValue(v), { size: 10, fill: theme.text2, anchor: 'middle' });
      });
    });
  };

  const drawLines = (seriesList, scale, offset, { area = false, stackedArea = false } = {}) => {
    const markers = n <= 40;
    const cum = new Array(n).fill(0);
    seriesList.forEach((s, kLocal) => {
      const k = kLocal + offset;
      const c = theme.series[k % theme.series.length];
      const stroke = strokeFor(c);
      let pts;
      if (stackedArea) {
        const lower = [...cum];
        s.values.forEach((v, i) => { cum[i] += v || 0; });
        pts = cum.map((v, i) => [cx(i), scale(v)]);
        const base = lower.map((v, i) => [cx(i), scale(v)]).reverse();
        const top = linePath(pts, opts.smooth);
        const back = linePath(base, opts.smooth).replace(/^M/, 'L');
        out += `<path d="${top}${back}Z" fill="${c}" fill-opacity="0.75" stroke="${theme.surface}" stroke-width="1"></path>`;
        return;
      }
      pts = s.values.map((v, i) => (v === null ? null : [cx(i), scale(v)]));
      const segments = [];
      let cur = [];
      pts.forEach(p => { if (p) cur.push(p); else if (cur.length) { segments.push(cur); cur = []; } });
      if (cur.length) segments.push(cur);
      segments.forEach(seg => {
        const d = linePath(seg, opts.smooth);
        if (area) {
          const base = scale(Math.max(vs.lo, Math.min(0, vs.hi)));
          out += `<path d="${d}L${f1(seg[seg.length - 1][0])},${f1(base)}L${f1(seg[0][0])},${f1(base)}Z" fill="${c}" fill-opacity="0.18"></path>`;
        }
        out += `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"></path>`;
      });
      if (markers) pts.forEach(p => { if (p) out += `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="4" fill="${c}" stroke="${stroke === c ? theme.surface : stroke}" stroke-width="2"></circle>`; });
      const idx = s.values.map((v, i) => (v === null ? -1 : i)).filter(i => i >= 0);
      if (labelsOn) idx.forEach(i => { out += svgText(pts[i][0], pts[i][1] - 10, formatChartValue(s.values[i]), { size: 10, fill: theme.text2, anchor: 'middle' }); });
      else if (!labelsOff && seriesList.length === 1 && idx.length) {
        const last = idx[idx.length - 1];
        out += svgText(pts[last][0], pts[last][1] - 10, formatChartValue(s.values[last]), { size: 10, fill: theme.text2, anchor: 'middle', weight: 600 });
      }
    });
  };

  if (combo) {
    drawColumns(plotted.slice(0, 1), sy);
    drawLines(plotted.slice(1), sy2, 1);
  } else if (barLike) {
    drawColumns(plotted, sy);
  } else {
    drawLines(plotted, sy, 0, { area: t === 'area', stackedArea: t === 'stackedArea' });
  }
  activeFormat = prevFormat;
  return wrapSvg(W, H, theme, header + out + hover);
}

// ---- Pie / doughnut ----
// Legend beside the pie on a wide canvas (synth-sql's only layout, drawn at
// 760px+); below it on a narrow one, where a side legend has no room.
const PIE_STACK_BELOW = 480;

function renderPieSVG(spec, data, theme, size, options) {
  const W = size.width;
  const [header, top] = renderChartHeader(spec, theme, W, [], options);
  const values = data.series[0].values.map(v => v || 0);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const showLegend = options.legend;
  const stacked = W < PIE_STACK_BELOW;
  let H = Math.max(options.minPieHeight, size.height);
  const legendW = !showLegend ? 0 : stacked ? W - 48 : Math.min(380, Math.max(150, W * 0.42));
  const legendRowH = stacked ? 24 : 30;
  let r, cx, cy, lx, ly0;
  if (!showLegend) {
    r = Math.max(50, Math.min(260, (H - top - 24) / 2, (W - 48) / 2));
    cx = W / 2; cy = top + 8 + Math.max(r, (H - top - 24) / 2); lx = 0; ly0 = 0;
  } else if (stacked) {
    const legendH = values.length * legendRowH + 12;
    r = Math.max(50, Math.min(200, (H - top - legendH - 32) / 2, (W - 48) / 2));
    cx = W / 2;
    cy = top + 8 + r;
    lx = 24;
    ly0 = cy + r + 32;
    H = Math.max(H, ly0 + values.length * legendRowH);
  } else {
    r = Math.max(60, Math.min(260, (H - top - 24) / 2, (W - legendW - 120) / 2));
    const groupW = 2 * r + 48 + legendW;
    cx = Math.max(24, (W - groupW) / 2) + r;
    cy = top + 8 + Math.max(r, (H - top - 24) / 2);
    lx = cx + r + 48;
    ly0 = cy - (values.length * legendRowH) / 2 + 12;
  }
  const inner = spec.type === 'doughnut' ? r * 0.58 : 0;
  let out = '';
  let angle = -Math.PI / 2;
  const pt = (a, rad) => [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
  values.forEach((v, i) => {
    const sweep = v / total * Math.PI * 2;
    const a0 = angle, a1 = angle + sweep;
    angle = a1;
    const large = sweep > Math.PI ? 1 : 0;
    const c = theme.series[i % theme.series.length];
    let d;
    if (sweep >= Math.PI * 2 - 1e-6) {
      d = inner
        ? `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0ZM${cx - inner},${cy}a${inner},${inner} 0 1,1 ${2 * inner},0a${inner},${inner} 0 1,1 ${-2 * inner},0Z`
        : `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
    } else {
      const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
      if (inner) {
        const [ix0, iy0] = pt(a0, inner), [ix1, iy1] = pt(a1, inner);
        d = `M${f1(x0)},${f1(y0)}A${r},${r} 0 ${large},1 ${f1(x1)},${f1(y1)}L${f1(ix1)},${f1(iy1)}A${f1(inner)},${f1(inner)} 0 ${large},0 ${f1(ix0)},${f1(iy0)}Z`;
      } else {
        d = `M${cx},${cy}L${f1(x0)},${f1(y0)}A${r},${r} 0 ${large},1 ${f1(x1)},${f1(y1)}Z`;
      }
    }
    const pct = v / total * 100;
    out += `<path class="chart-mark" d="${d}" fill="${c}" fill-rule="evenodd" stroke="${theme.surface}" stroke-width="2"><title>${escapeXml(`${data.categories[i]}: ${formatChartValue(v)} (${pct.toFixed(1)}%)`)}</title></path>`;
    if (pct >= 6 && options.dataLabels !== 'off') {
      const [lx0, ly] = pt((a0 + a1) / 2, inner ? (r + inner) / 2 : r * 0.64);
      out += svgText(lx0, ly + 4, `${Math.round(pct)}%`, { size: 11, fill: inkOn(c, theme), anchor: 'middle', weight: 600 });
    }
  });
  if (inner) {
    out += svgText(cx, cy - 2, formatChartValue(total), { size: 20, fill: theme.text, anchor: 'middle', weight: 600 });
    out += svgText(cx, cy + 18, clip(spec.yAxisTitle || 'Total', 22), { size: 11, fill: theme.text2, anchor: 'middle' });
  }
  if (showLegend) {
    const legendRight = Math.min(W - 24, lx + legendW);
    values.forEach((v, i) => {
      const y = ly0 + i * legendRowH;
      const valueText = `${formatChartValue(v)}  ·  ${(v / total * 100).toFixed(1)}%`;
      const labelRoom = legendRight - textW(valueText, 12) - 12 - (lx + 20);
      out += `<rect x="${f1(lx)}" y="${f1(y - 10)}" width="12" height="12" rx="2" fill="${theme.series[i % theme.series.length]}"></rect>`;
      out += svgText(lx + 20, y, clip(data.categories[i], Math.max(4, Math.floor(labelRoom / (12 * 0.58)))), { size: 12, fill: theme.text });
      out += svgText(legendRight, y, valueText, { size: 12, fill: theme.text2, anchor: 'end' });
    });
  }
  return wrapSvg(W, H, theme, header + out);
}

// ---- Treemap (squarified) ----
function squarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!items.length || total <= 0) return out;
  const scale = (w * h) / total;
  let rest = items.map(it => ({ ...it, area: it.value * scale }));
  let rx = x, ry = y, rw = w, rh = h;
  const worst = (row, side) => {
    const s = row.reduce((a, b) => a + b.area, 0);
    const max = Math.max(...row.map(r => r.area)), min = Math.min(...row.map(r => r.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  while (rest.length) {
    const side = Math.min(rw, rh);
    let row = [rest[0]];
    let i = 1;
    while (i < rest.length && worst([...row, rest[i]], side) <= worst(row, side)) { row.push(rest[i]); i++; }
    rest = rest.slice(i);
    const s = row.reduce((a, b) => a + b.area, 0);
    if (rw >= rh) {
      const cw = s / rh;
      let cy = ry;
      row.forEach(r => { const chh = r.area / cw; out.push({ ...r, x: rx, y: cy, w: cw, h: chh }); cy += chh; });
      rx += cw; rw -= cw;
    } else {
      const chh = s / rw;
      let cx = rx;
      row.forEach(r => { const cww = r.area / chh; out.push({ ...r, x: cx, y: ry, w: cww, h: chh }); cx += cww; });
      ry += chh; rh -= chh;
    }
  }
  return out;
}

function renderTreemapSVG(spec, data, theme, size, opts) {
  const W = size.width;
  const [header, top] = renderChartHeader(spec, theme, W, [], opts);
  const H = Math.max(size.height, opts.minPieHeight);
  const items = data.categories.map((c, i) => ({ label: c, value: data.series[0].values[i] || 0, i })).filter(it => it.value > 0).sort((a, b) => b.value - a.value);
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  const rects = squarify(items, 12, top, W - 24, H - top - 12);
  let out = '';
  rects.forEach((r, k) => {
    const c = theme.series[k % theme.series.length];
    const ink = inkOn(c, theme);
    out += `<g><title>${escapeXml(`${r.label}: ${formatChartValue(r.value)} (${(r.value / total * 100).toFixed(1)}%)`)}</title><rect class="chart-mark" x="${f1(r.x + 1.5)}" y="${f1(r.y + 1.5)}" width="${f1(Math.max(0, r.w - 3))}" height="${f1(Math.max(0, r.h - 3))}" rx="6" fill="${c}"></rect>`;
    if (r.w > 44 && r.h > 30) {
      out += svgText(r.x + 10, r.y + 22, clip(r.label, Math.floor((r.w - 16) / 7)), { size: 12, fill: ink, weight: 600 });
      if (r.h > 48 && opts.dataLabels !== 'off') out += svgText(r.x + 10, r.y + 40, formatChartValue(r.value), { size: 11, fill: ink });
    }
    out += '</g>';
  });
  return wrapSvg(W, H, theme, header + out);
}

// ---- Funnel ----
function renderFunnelSVG(spec, data, theme, size, opts) {
  const W = size.width;
  const [header, top] = renderChartHeader(spec, theme, W, [], opts);
  const vals = data.series[0].values.map(v => v || 0);
  const n = vals.length;
  const max = Math.max(...vals, 1);
  const labelW = Math.min(160, Math.max(...data.categories.map(c => textW(clip(c, 22), 12)), 40) + 16);
  const H = Math.max(size.height, top + n * 34 + 16);
  const rowH = Math.min(56, (H - top - 16) / n);
  const cxm = labelW + (W - labelW - 16) / 2;
  const maxW = W - labelW - 32;
  let out = '';
  vals.forEach((v, i) => {
    const w = Math.max(6, (v / max) * maxW);
    const y = top + i * rowH;
    const c = theme.series[(opts.varyColors ? i : 0) % theme.series.length];
    const pctFirst = vals[0] ? (v / vals[0]) * 100 : 0;
    out += `<g><title>${escapeXml(`${data.categories[i]}: ${formatChartValue(v)} (${pctFirst.toFixed(1)}% of first)`)}</title>`;
    out += `<rect class="chart-mark" x="${f1(cxm - w / 2)}" y="${f1(y + 3)}" width="${f1(w)}" height="${f1(rowH - 6)}" rx="6" fill="${c}" fill-opacity="${opts.varyColors ? 1 : Math.max(0.35, 1 - i * 0.1)}"></rect></g>`;
    out += svgText(labelW - 8, y + rowH / 2 + 4, clip(data.categories[i], 22), { size: 12, fill: theme.text2, anchor: 'end' });
    if (opts.dataLabels !== 'off') {
      const label = `${formatChartValue(v)}${i > 0 ? ` · ${pctFirst.toFixed(0)}%` : ''}`;
      const inside = textW(label, 11) < w - 12;
      out += svgText(inside ? cxm : cxm + w / 2 + 6, y + rowH / 2 + 4, label, { size: 11, fill: inside ? inkOn(c, theme) : theme.text2, anchor: inside ? 'middle' : 'start', weight: 600 });
    }
  });
  return wrapSvg(W, H, theme, header + out);
}

// ---- Waterfall ----
function renderWaterfallSVG(spec, data, theme, size, opts) {
  const W = size.width;
  const [header, top] = renderChartHeader(spec, theme, W, [], opts);
  const deltas = data.series[0].values.map(v => v || 0);
  const cats = [...data.categories, 'Total'];
  let run = 0;
  const bars = deltas.map(d => { const from = run; run += d; return { from, to: run, d }; });
  bars.push({ from: 0, to: run, d: run, total: true });
  const lo = Math.min(0, ...bars.map(b => Math.min(b.from, b.to)));
  const hi = Math.max(0, ...bars.map(b => Math.max(b.from, b.to)));
  const vs = niceScale(lo, hi);
  const labels = vs.ticks.map(tk => formatTick(tk, vs.step));
  const left = 20 + Math.max(...labels.map(l => textW(l, 11))) + 10;
  const right = W - 20;
  const n = cats.length;
  const band = (right - left) / n;
  const catLabels = cats.map(c => clip(c, 14));
  const rotate = Math.max(...catLabels.map(l => textW(l, 11))) > band - 6;
  const H = Math.max(size.height, top + opts.minPlotHeight + 40);
  const bottom = H - (rotate ? 56 : 28);
  const sy = v => bottom - (v - vs.lo) / (vs.hi - vs.lo) * (bottom - top);
  let out = '';
  vs.ticks.forEach((tk, i) => {
    out += `<line x1="${left}" y1="${f1(sy(tk))}" x2="${right}" y2="${f1(sy(tk))}" stroke="${tk === 0 ? theme.axis : opts.gridlines ? theme.grid : 'none'}"></line>`;
    out += svgText(left - 8, sy(tk) + 4, labels[i], { size: 11, fill: theme.text2, anchor: 'end' });
  });
  const up = theme.series[0], down = theme.negative || '#d03238', tot = theme.series[1 % theme.series.length];
  bars.forEach((b, i) => {
    const x = left + band * i + band * 0.16;
    const w = band * 0.68;
    const y0 = sy(b.from), y1 = sy(b.to);
    const c = b.total ? tot : b.d >= 0 ? up : down;
    out += `<g><title>${escapeXml(`${cats[i]}: ${formatChartValue(b.d)}${b.total ? '' : `\nRunning total: ${formatChartValue(b.to)}`}`)}</title><rect class="chart-mark" x="${f1(x)}" y="${f1(Math.min(y0, y1))}" width="${f1(w)}" height="${f1(Math.max(1, Math.abs(y1 - y0)))}" rx="3" fill="${c}"></rect></g>`;
    if (i < bars.length - 1) out += `<line x1="${f1(x + w)}" y1="${f1(y1)}" x2="${f1(x + band)}" y2="${f1(y1)}" stroke="${theme.axis}" stroke-dasharray="3 3"></line>`;
    if (opts.dataLabels !== 'off' && n <= 24) out += svgText(x + w / 2, Math.min(y0, y1) - 6, formatChartValue(b.d), { size: 10, fill: theme.text2, anchor: 'middle' });
    const lx = x + w / 2;
    out += rotate
      ? svgText(lx + 3, bottom + 14, catLabels[i], { size: 11, fill: theme.text2, anchor: 'end', rotate: -40 })
      : svgText(lx, bottom + 16, catLabels[i], { size: 11, fill: theme.text2, anchor: 'middle', weight: b.total ? 600 : 400 });
  });
  return wrapSvg(W, H, theme, header + out);
}

// ---- Heatmap (category x split-by matrix) ----
function renderHeatmapSVG(spec, data, theme, size, opts) {
  const W = size.width;
  const [header, top] = renderChartHeader(spec, theme, W, [], opts);
  const rowsL = data.categories;
  const cols = data.series.map(s => s.name);
  const all = data.series.flatMap(s => s.values).filter(v => v !== null);
  const lo = Math.min(...all, 0), hi = Math.max(...all, 1);
  const rowLabelW = Math.min(160, Math.max(...rowsL.map(r => textW(clip(r, 20), 11)), 30) + 14);
  const colH = 28;
  const gridW = W - rowLabelW - 16;
  const cw = gridW / Math.max(1, cols.length);
  const H0 = Math.max(size.height, top + colH + rowsL.length * 22 + 12);
  const ch = Math.max(20, Math.min(48, (H0 - top - colH - 12) / Math.max(1, rowsL.length)));
  const H = top + colH + ch * rowsL.length + 12;
  const base = theme.series[0];
  const heat = relativeLuminance(base) > 0.45 ? mixHex(base, '#163300', 0.55) : base;
  let out = '';
  cols.forEach((c, j) => { out += svgText(rowLabelW + cw * (j + 0.5), top + 16, clip(c, Math.max(3, Math.floor(cw / 7))), { size: 11, fill: theme.text2, anchor: 'middle', weight: 600 }); });
  rowsL.forEach((r, i) => {
    const y = top + colH + i * ch;
    out += svgText(rowLabelW - 8, y + ch / 2 + 4, clip(r, 20), { size: 11, fill: theme.text2, anchor: 'end' });
    data.series.forEach((s, j) => {
      const v = s.values[i];
      const tt = v === null ? 0 : (v - lo) / ((hi - lo) || 1);
      const fill = v === null ? theme.grid : mixHex('#f4f7f2', heat, 0.08 + tt * 0.92);
      out += `<g><title>${escapeXml(`${r} · ${s.name}: ${formatChartValue(v)}`)}</title><rect class="chart-mark" x="${f1(rowLabelW + cw * j + 1)}" y="${f1(y + 1)}" width="${f1(cw - 2)}" height="${f1(ch - 2)}" rx="4" fill="${fill}"></rect></g>`;
      if (v !== null && opts.dataLabels !== 'off' && cw > 36 && ch >= 18) out += svgText(rowLabelW + cw * (j + 0.5), y + ch / 2 + 4, formatChartValue(v), { size: 10, fill: inkOn(fill, theme), anchor: 'middle' });
    });
  });
  return wrapSvg(W, H, theme, header + out);
}

// ---- Radar ----
function renderRadarSVG(spec, data, theme, size, opts) {
  const W = size.width;
  const legend = data.series.map((s, i) => ({ label: s.name, color: theme.series[i % theme.series.length] }));
  const [header, top] = renderChartHeader(spec, theme, W, legend, opts);
  const H = Math.max(size.height, opts.minPieHeight);
  const n = data.categories.length;
  const r = Math.max(40, Math.min((W - 140) / 2, (H - top - 40) / 2));
  const cx = W / 2, cy = top + 20 + r;
  const all = data.series.flatMap(s => s.values).filter(v => v !== null);
  const vs = niceScale(Math.min(0, ...all), Math.max(...all, 1), 4);
  const ang = i => -Math.PI / 2 + (i / n) * Math.PI * 2;
  const pt = (i, v) => { const rr = ((v - vs.lo) / (vs.hi - vs.lo)) * r; return [cx + Math.cos(ang(i)) * rr, cy + Math.sin(ang(i)) * rr]; };
  let out = '';
  vs.ticks.slice(1).forEach(tk => {
    const ring = data.categories.map((_, i) => pt(i, tk));
    out += `<path d="${ring.map((p, j) => `${j ? 'L' : 'M'}${f1(p[0])},${f1(p[1])}`).join('')}Z" fill="none" stroke="${opts.gridlines ? theme.grid : 'none'}"></path>`;
    out += svgText(cx + 4, pt(0, tk)[1] - 3, formatTick(tk, vs.step), { size: 9, fill: theme.text2 });
  });
  data.categories.forEach((c, i) => {
    const [x, y] = pt(i, vs.hi);
    out += `<line x1="${cx}" y1="${cy}" x2="${f1(x)}" y2="${f1(y)}" stroke="${theme.grid}"></line>`;
    const [lx, ly] = [cx + Math.cos(ang(i)) * (r + 14), cy + Math.sin(ang(i)) * (r + 14)];
    const anchor = Math.abs(Math.cos(ang(i))) < 0.2 ? 'middle' : Math.cos(ang(i)) > 0 ? 'start' : 'end';
    out += svgText(lx, ly + 4, clip(c, 16), { size: 11, fill: theme.text2, anchor });
  });
  data.series.forEach((s, k) => {
    const c = theme.series[k % theme.series.length];
    const pts = s.values.map((v, i) => pt(i, v || 0));
    out += `<path class="chart-mark" d="${pts.map((p, j) => `${j ? 'L' : 'M'}${f1(p[0])},${f1(p[1])}`).join('')}Z" fill="${c}" fill-opacity="0.22" stroke="${strokeFor(c)}" stroke-width="2"><title>${escapeXml(s.name)}</title></path>`;
    pts.forEach((p, i) => { out += `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="3" fill="${strokeFor(c)}"><title>${escapeXml(`${data.categories[i]} · ${s.name}: ${formatChartValue(s.values[i])}`)}</title></circle>`; });
  });
  return wrapSvg(W, H, theme, header + out);
}

// ---- KPI card ----
function renderKpiSVG(spec, data, theme, size, opts) {
  const W = size.width;
  const H = Math.max(size.height, 110);
  const k = data.kpi;
  const valueText = formatChartValue(k.value);
  const sparkH = k.spark && k.spark.length > 1 && H > 150 ? Math.min(70, H * 0.28) : 0;
  const fs = Math.max(22, Math.min(96, (W - 32) / Math.max(3, valueText.length * 0.62), (H - sparkH - 40) * 0.55));
  const accent = theme.series[0];
  let out = '';
  const cy = (H - sparkH) / 2 + fs * 0.3;
  out += svgText(W / 2, cy, valueText, { size: fs, fill: theme.text, anchor: 'middle', weight: 800, family: opts.displayFont });
  const label = spec.yAxisTitle || k.label;
  const sub = k.mode === 'total' ? `Total ${label}`.trim() : label;
  out += svgText(W / 2, cy + Math.max(18, fs * 0.36), clip(sub, Math.floor(W / 7)), { size: Math.max(12, Math.min(16, fs * 0.2)), fill: theme.text2, anchor: 'middle' });
  if (k.previous !== null && k.previous !== undefined && k.previous !== 0) {
    const delta = ((k.value - k.previous) / Math.abs(k.previous)) * 100;
    const good = delta >= 0;
    const dt = `${good ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}% vs. previous`;
    out += svgText(W / 2, cy + Math.max(38, fs * 0.36 + 22), dt, { size: 12, fill: good ? (theme.positive || '#054d28') : (theme.negative || '#a72027'), anchor: 'middle', weight: 600 });
  }
  if (k.target !== null && k.target !== undefined && k.target !== 0) {
    const pct = (k.value / k.target) * 100;
    out += svgText(W / 2, cy + Math.max(38, fs * 0.36 + 22), `${pct.toFixed(0)}% of target ${formatChartValue(k.target)}`, { size: 12, fill: theme.text2, anchor: 'middle' });
  }
  if (sparkH) {
    const s = k.spark;
    const lo = Math.min(...s), hi = Math.max(...s);
    const x0 = 16, x1 = W - 16, y0 = H - 10, y1 = H - sparkH;
    const pts = s.map((v, i) => [x0 + (i / (s.length - 1)) * (x1 - x0), y0 - ((v - lo) / ((hi - lo) || 1)) * (y0 - y1)]);
    const d = linePath(pts, true);
    out += `<path d="${d}L${f1(x1)},${f1(y0)}L${f1(x0)},${f1(y0)}Z" fill="${accent}" fill-opacity="0.25"></path>`;
    out += `<path d="${d}" fill="none" stroke="${strokeFor(accent)}" stroke-width="2"></path>`;
  }
  return wrapSvg(W, H, theme, out);
}

// ---- Gauge ----
function renderGaugeSVG(spec, data, theme, size, opts) {
  const W = size.width;
  const [header, top] = renderChartHeader(spec, theme, W, [], opts);
  const H = Math.max(size.height, 150);
  const k = data.kpi;
  const value = k.value || 0;
  const max = k.target && k.target > 0 ? k.target : niceScale(0, Math.max(value * 1.25, 1)).hi;
  const r = Math.max(40, Math.min((W - 48) / 2, H - top - 50));
  const cx = W / 2, cy = top + 10 + r;
  const stroke = Math.max(12, r * 0.22);
  const arc = (from, to) => {
    const a0 = Math.PI + from * Math.PI, a1 = Math.PI + to * Math.PI;
    const [x0, y0] = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
    const [x1, y1] = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r];
    return `M${f1(x0)},${f1(y0)}A${r},${r} 0 ${to - from > 1 ? 1 : 0},1 ${f1(x1)},${f1(y1)}`;
  };
  const frac = Math.max(0, Math.min(1, value / max));
  let out = `<path d="${arc(0, 1)}" fill="none" stroke="${theme.grid}" stroke-width="${f1(stroke)}" stroke-linecap="round"></path>`;
  if (frac > 0) out += `<path class="chart-mark" d="${arc(0, Math.max(0.005, frac))}" fill="none" stroke="${theme.series[0]}" stroke-width="${f1(stroke)}" stroke-linecap="round"><title>${escapeXml(`${formatChartValue(value)} of ${formatChartValue(max)}`)}</title></path>`;
  const fs = Math.max(18, Math.min(48, r * 0.42));
  out += svgText(cx, cy - 4, formatChartValue(value), { size: fs, fill: theme.text, anchor: 'middle', weight: 800 });
  out += svgText(cx, cy + 16, clip(spec.yAxisTitle || k.label, 26), { size: 12, fill: theme.text2, anchor: 'middle' });
  out += svgText(cx - r, cy + stroke / 2 + 16, '0', { size: 11, fill: theme.text2, anchor: 'middle' });
  out += svgText(cx + r, cy + stroke / 2 + 16, formatChartValue(max), { size: 11, fill: theme.text2, anchor: 'middle' });
  return wrapSvg(W, H, theme, header + out);
}

// ---- Table visual ----
function renderTableSVG(spec, data, theme, size, opts) {
  const W = size.width;
  const { columns, rows } = data.table;
  const rowH = 28;
  const headH = 32;
  const numericCol = columns.map((_, j) => rows.length > 0 && rows.slice(0, 50).every(r => r[j] === null || r[j] === '' || parseChartNumber(r[j]) !== null));
  const want = columns.map((c, j) => Math.min(260, Math.max(textW(c, 12), ...rows.slice(0, 50).map(r => textW(r[j] === null ? '' : String(r[j]), 12))) + 24));
  const total = want.reduce((a, b) => a + b, 0);
  const widths = want.map(w => (w / total) * (W - 16));
  const H = Math.max(size.height, headH + rows.length * rowH + 8);
  let out = `<rect x="8" y="4" width="${W - 16}" height="${headH}" rx="8" fill="${theme.grid}"></rect>`;
  let x = 8;
  columns.forEach((c, j) => {
    const w = widths[j];
    out += svgText(numericCol[j] ? x + w - 10 : x + 10, 4 + headH / 2 + 4, clip(c, Math.floor((w - 16) / 7)), { size: 12, fill: theme.text, weight: 600, anchor: numericCol[j] ? 'end' : 'start' });
    x += w;
  });
  rows.forEach((r, i) => {
    const y = 4 + headH + i * rowH;
    if (i % 2 === 1) out += `<rect x="8" y="${y}" width="${W - 16}" height="${rowH}" fill="${theme.grid}" fill-opacity="0.45"></rect>`;
    let xx = 8;
    r.forEach((v, j) => {
      const w = widths[j];
      const n = numericCol[j] ? parseChartNumber(v) : null;
      const text = v === null || v === undefined ? '' : n !== null ? formatChartValue(n) : String(v);
      out += svgText(numericCol[j] ? xx + w - 10 : xx + 10, y + rowH / 2 + 4, clip(text, Math.max(2, Math.floor((w - 16) / 6.6))), { size: 12, fill: theme.text2, anchor: numericCol[j] ? 'end' : 'start' });
      xx += w;
    });
  });
  return wrapSvg(W, H, theme, out);
}

function wrapSvg(W, H, theme, body) {
  const family = escapeXml(theme.fontFamily || 'Inter, system-ui, sans-serif');
  return `<svg viewBox="0 0 ${W} ${f1(H)}" xmlns="http://www.w3.org/2000/svg" font-family="${family}" role="img">
    <rect x="0" y="0" width="${W}" height="${f1(H)}" fill="${theme.surface}"></rect>${body}</svg>`;
}

const DEFAULT_RENDER_OPTIONS = { showTitle: true, minPlotHeight: 300, minPieHeight: 420 };

export function renderChartSVG(spec, data, theme, size = { width: 760, height: 420 }, options = {}) {
  const st = { ...DEFAULT_STYLE, ...(spec.style || {}) };
  const opts = {
    ...DEFAULT_RENDER_OPTIONS,
    legend: st.legend !== false,
    dataLabels: st.dataLabels || 'auto',
    gridlines: st.gridlines !== false,
    smooth: !!st.smooth,
    varyColors: !!st.varyColors,
    displayFont: "Manrope, Inter, system-ui, sans-serif",
    ...options,
  };
  const styled = applyChartStyle(theme, spec.style);
  const prevFormat = activeFormat;
  activeFormat = st.format || 'auto';
  try {
    switch (spec.type) {
      case 'pie':
      case 'doughnut': return renderPieSVG(spec, data, styled, size, opts);
      case 'treemap': return renderTreemapSVG(spec, data, styled, size, opts);
      case 'funnel': return renderFunnelSVG(spec, data, styled, size, opts);
      case 'waterfall': return renderWaterfallSVG(spec, data, styled, size, opts);
      case 'heatmap': return renderHeatmapSVG(spec, data, styled, size, opts);
      case 'radar': return renderRadarSVG(spec, data, styled, size, opts);
      case 'kpi': return renderKpiSVG(spec, data, styled, size, opts);
      case 'gauge': return renderGaugeSVG(spec, data, styled, size, opts);
      case 'table': return renderTableSVG(spec, data, styled, size, opts);
      default: return renderCartesianSVG(spec, data, styled, size, opts);
    }
  } finally {
    activeFormat = prevFormat;
  }
}
