// shared/chart-engine.js — the framework-agnostic core of synth-sql's
// charts.js: analyzeChartColumns(), heuristicChartSpec(), buildChartData(),
// and the SVG renderers (renderChartSVG / renderCartesianSVG / renderPieSVG).
// These are pure functions (spec + data + theme -> SVG string) with no DOM
// dependency beyond string building, so this one module is importable both
// ways:
//
//   - the vanilla shell, via a plain <script type="module"> tag (e.g. the
//     home view's miniature dashboard thumbnails)
//   - the dashboard/ React island's Vite build, via a normal ES import,
//     wrapped in a thin <Tile> component that sets the returned SVG string
//     as its content
//
// One engine, one set of chart-rendering bugs to fix, both consumers share
// it. AI chart-spec refinement (requestAiChartSpec) stays out of here —
// that's chat.js's job, this module only turns a spec into pixels.
//
// Changes from synth-sql's charts.js, all additive — the spec/data model is
// unchanged, so a spec that drew in synth-sql draws identically here:
//   - Theme is a parameter (see shared/chart-themes.js) instead of
//     chartTheme()'s light/dark-only CSS-variable lookup, so the same
//     renderer can serve the Power BI/Tableau preview skins (§8a, v1.1).
//     A theme may also carry fontFamily.
//   - renderChartSVG() takes an optional 5th `options` argument:
//     showTitle (tiles draw their title in HTML chrome, not the SVG),
//     minPlotHeight / minPieHeight (tiles are much smaller than
//     synth-sql's 760x420 results chart). Defaults reproduce synth-sql.
//   - The pie legend width scales with the canvas instead of a fixed 380px.
//   - resolveChartSpec() / serializeChartSpec(): tiles persist chartSpec by
//     column *name* (see state.js), generalizing synth-sql's aiRawToSpec()
//     name-to-index mapping so stored, AI-proposed, and hand-built specs
//     all go through one path.
//
// A chart "spec" at render time:
//   { type, title, category, values, xAxisTitle, yAxisTitle }
// category/values are column indexes (category -1 = row number).
// xAxisTitle always names the category axis and yAxisTitle the value
// axis, whichever way the chart is oriented (matches Excel's model).

export const CHART_TYPES = [
  { id: 'column', label: 'Column' },
  { id: 'bar', label: 'Bar (horizontal)' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'pie', label: 'Pie' },
  { id: 'doughnut', label: 'Doughnut' },
  { id: 'scatter', label: 'Scatter' },
];
export const CHART_TYPE_IDS = CHART_TYPES.map(t => t.id);
export const MAX_SERIES = 6;
export const MAX_SCATTER_SERIES = 3;
export const MAX_PIE_SLICES = 6;
export const MAX_POINTS = { column: 50, bar: 60, line: 1000, area: 1000, scatter: 2000, pie: MAX_PIE_SLICES, doughnut: MAX_PIE_SLICES };

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

// Forces a spec into something drawable for these columns: valid
// type, category, and 1..N numeric value columns.
export function normalizeChartSpec(spec, info, rowCount) {
  const s = { ...spec };
  if (!CHART_TYPE_IDS.includes(s.type)) s.type = 'column';
  if (!(Number.isInteger(s.category) && s.category >= -1 && s.category < info.length)) s.category = -1;

  if (s.type === 'scatter' && (s.category < 0 || info[s.category].kind !== 'numeric')) {
    const x = info.find(c => c.kind === 'numeric' && !(s.values || []).includes(c.index));
    if (x) s.category = x.index; else s.type = 'column';
  }

  let values = (s.values || []).filter((v, i, arr) => Number.isInteger(v) && info[v] && info[v].kind === 'numeric' && v !== s.category && arr.indexOf(v) === i);
  if (!values.length) {
    const first = numericCandidates(info, s.category)[0] || info.find(c => c.kind === 'numeric' && c.index !== s.category);
    if (first) values = [first.index];
  }
  if (s.type === 'scatter') values = values.slice(0, MAX_SCATTER_SERIES);
  else if (s.type === 'pie' || s.type === 'doughnut') values = values.slice(0, 1);
  else values = values.slice(0, MAX_SERIES);
  s.values = values;

  if ((s.type === 'pie' || s.type === 'doughnut') && rowCount > MAX_PIE_SLICES) s.type = 'column';
  if (!s.title) s.title = defaultChartTitle(s, info);
  if (s.xAxisTitle === undefined) s.xAxisTitle = s.category >= 0 ? prettifyColumnName(info[s.category].name) : 'Row';
  if (s.yAxisTitle === undefined) s.yAxisTitle = values.length === 1 ? prettifyColumnName(info[values[0]].name) : 'Value';
  return s;
}

export function defaultChartTitle(s, info) {
  if (!s.values || !s.values.length) return 'Chart';
  const ys = s.values.map(v => prettifyColumnName(info[v].name));
  const x = s.category >= 0 ? prettifyColumnName(info[s.category].name) : null;
  let yPart = ys.length <= 2 ? ys.join(' and ') : `${ys.slice(0, -1).join(', ')} and ${ys[ys.length - 1]}`;
  if (yPart.length > 45) yPart = `${ys.slice(0, 2).join(', ')} and more`;
  if (s.type === 'scatter') return `${yPart} vs. ${x}`;
  if (!x) return yPart;
  return `${yPart} by ${x}`;
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
  let spec;
  if (temporal) {
    spec = { type: 'line', category: temporal.index, values: numericCandidates(info, temporal.index).map(c => c.index) };
  } else if (texts.length) {
    const cat = texts[0];
    let type = 'column';
    if (rowCount > MAX_POINTS.bar) type = 'line';
    else if (rowCount > 15 || cat.avgLen > 14) type = 'bar';
    spec = { type, category: cat.index, values: numericCandidates(info, cat.index).map(c => c.index) };
  } else {
    const nums = numericCandidates(info, -1);
    if (nums.length >= 2 && rowCount > 1) spec = { type: 'scatter', category: nums[0].index, values: nums.slice(1).map(c => c.index) };
    else spec = { type: rowCount > MAX_POINTS.column ? 'line' : 'column', category: -1, values: nums.map(c => c.index) };
  }
  spec.values = keepComparableSeries(spec.values, info);
  const normalized = normalizeChartSpec(spec, info, rowCount);
  if (!normalized.values.length) {
    return { error: 'Charts need at least one numeric column to plot. Try an aggregate, e.g. SELECT category, COUNT(*) FROM your_table GROUP BY category.' };
  }
  return normalized;
}

export function chartTypeAllowed(type, info, rowCount) {
  if (type === 'pie' || type === 'doughnut') return rowCount <= MAX_PIE_SLICES;
  if (type === 'scatter') return info.filter(c => c.kind === 'numeric').length >= 2;
  return true;
}

// ---- Name-based specs (persistence / AI) ----
// Stored/AI shape: { type, title, category: <column name|null>, values:
// [<column name>], xAxisTitle, yAxisTitle }. Resolves to the index-based
// render spec for this particular result set, or falls back to the
// heuristic when the stored spec no longer fits (e.g. its columns were
// removed from the SQL). pruneIncomparable mirrors synth-sql's
// aiRawToSpec() behavior for AI proposals; a user's own picks are kept.
export function resolveChartSpec(stored, info, rowCount, { pruneIncomparable = false } = {}) {
  if (!stored) return heuristicChartSpec(info, rowCount);
  const byName = name => {
    if (name === null || name === undefined || name === '') return -1;
    const exact = info.find(c => c.name === name);
    if (exact) return exact.index;
    const loose = info.find(c => c.name.toLowerCase() === String(name).toLowerCase());
    return loose ? loose.index : -2;
  };
  const category = byName(stored.category);
  const requested = (Array.isArray(stored.values) ? stored.values : []).map(byName).filter(i => i >= 0 && info[i].kind === 'numeric');
  const values = pruneIncomparable ? keepComparableSeries(requested, info) : requested;
  if (!values.length || category === -2) {
    const fallback = heuristicChartSpec(info, rowCount);
    if (!fallback.error && stored.title) fallback.title = stored.title;
    return fallback;
  }
  // A blank stored title means "auto" (the generated default), not "no title".
  const clean = t => typeof t === 'string' && t.trim() ? t.replace(/\s+/g, ' ').trim().slice(0, 90) : undefined;
  const pruned = values.length !== requested.length;
  return normalizeChartSpec({
    type: CHART_TYPE_IDS.includes(stored.type) ? stored.type : 'column',
    category,
    values,
    title: pruned ? undefined : clean(stored.title),
    xAxisTitle: clean(stored.xAxisTitle),
    yAxisTitle: pruned ? undefined : clean(stored.yAxisTitle),
  }, info, rowCount);
}

export function serializeChartSpec(spec, info) {
  return {
    type: spec.type,
    title: spec.title || '',
    category: spec.category >= 0 && info[spec.category] ? info[spec.category].name : null,
    values: spec.values.filter(v => info[v]).map(v => info[v].name),
    xAxisTitle: spec.xAxisTitle ?? '',
    yAxisTitle: spec.yAxisTitle ?? '',
  };
}

// ---- Data prep ----
export function buildChartData(spec, columns, rows) {
  const cap = MAX_POINTS[spec.type] || 50;
  const series = spec.values.map((vc, i) => ({ name: prettifyColumnName(columns[vc]), rawName: columns[vc], colorIndex: i }));
  if (spec.type === 'scatter') {
    const points = [];
    for (const row of rows) {
      const x = parseChartNumber(row[spec.category]);
      if (x === null) continue;
      points.push({ x, ys: spec.values.map(vc => parseChartNumber(row[vc])) });
      if (points.length >= cap) break;
    }
    return { series, points, total: rows.length, shown: points.length };
  }
  let used = rows.slice(0, cap);
  let dropped = 0;
  if (spec.type === 'pie' || spec.type === 'doughnut') {
    const before = used.length;
    used = used.filter(r => (parseChartNumber(r[spec.values[0]]) || 0) > 0);
    dropped = before - used.length;
  }
  const categories = used.map((row, i) => {
    if (spec.category < 0) return String(i + 1);
    const v = row[spec.category];
    return v === null || v === undefined || v === '' ? '(blank)' : String(v);
  });
  series.forEach(s => {
    const vc = spec.values[s.colorIndex];
    s.values = used.map(row => parseChartNumber(row[vc]));
  });
  return { series, categories, total: rows.length, shown: used.length, dropped };
}

export function chartDataIsEmpty(spec, data) {
  return spec.type === 'scatter' ? !data.points.length : !data.categories.length;
}

// ---- SVG rendering ----
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

function formatTick(n, step) {
  if (Math.abs(n) >= 10000) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const decimals = step < 1 ? Math.min(4, Math.ceil(-Math.log10(step))) : 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatChartValue(n) {
  if (n === null || n === undefined) return '—';
  if (Math.abs(n) >= 100000) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const textW = (s, size) => String(s).length * size * 0.58;
const clip = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const f1 = n => (+n).toFixed(1);

// Rounded 4px data-end, square at the baseline.
function barPath(x, y, w, h, end) {
  if (w <= 0 || h <= 0) return '';
  const r = Math.min(4, end === 'up' || end === 'down' ? w / 2 : h / 2, end === 'up' || end === 'down' ? h : w);
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

// Title + legend block; returns [svg, heightUsed].
function renderChartHeader(spec, data, theme, W, legendItems, options) {
  let out = '';
  let y;
  if (options.showTitle) {
    out = svgText(20, 32, clip(spec.title || 'Untitled chart', 100), { size: 17, fill: spec.title ? theme.text : theme.text2, weight: 600, edit: 'title' });
    y = 44;
  } else {
    y = 4;
  }
  if (legendItems.length >= 2) {
    let x = 20;
    y += 14;
    legendItems.forEach(item => {
      const w = 16 + textW(item.label, 12) + 18;
      if (x + w > W - 20 && x > 20) { x = 20; y += 20; }
      out += `<rect x="${x}" y="${y - 9}" width="10" height="10" rx="2" fill="${item.color}"></rect>`;
      out += svgText(x + 16, y, item.label, { size: 12, fill: theme.text2 });
      x += w;
    });
    y += 6;
  }
  return [out, y + (options.showTitle ? 16 : 12)];
}

function renderCartesianSVG(spec, data, theme, size, options) {
  const W = size.width;
  const horizontal = spec.type === 'bar';
  const scatter = spec.type === 'scatter';
  const nSeries = data.series.length;
  const legend = data.series.map((s, i) => ({ label: s.name, color: theme.series[i % theme.series.length] }));
  const [header, top] = renderChartHeader(spec, data, theme, W, legend, options);

  const allVals = scatter
    ? data.points.flatMap(p => p.ys).filter(v => v !== null)
    : data.series.flatMap(s => s.values).filter(v => v !== null);
  let vMin = Math.min(...allVals), vMax = Math.max(...allVals);
  if (!allVals.length) { vMin = 0; vMax = 1; }
  const forceZero = spec.type === 'column' || spec.type === 'bar' || spec.type === 'area' || (vMin >= 0 && vMin <= vMax * 0.5);
  if (forceZero) { vMin = Math.min(0, vMin); vMax = Math.max(0, vMax); }
  const vs = niceScale(vMin, vMax);
  const tickLabels = vs.ticks.map(t => formatTick(t, vs.step));

  let out = '';
  const catTitle = spec.xAxisTitle, valTitle = spec.yAxisTitle;

  if (horizontal) {
    const n = data.categories.length;
    const catLabels = data.categories.map(c => clip(c, 22));
    const catLabelW = Math.max(...catLabels.map(l => textW(l, 11)), 10);
    const left = 20 + (catTitle ? 22 : 0) + catLabelW + 10;
    const tipLabels = nSeries === 1 && n <= 30;
    const tipW = tipLabels ? Math.max(...data.series[0].values.map(v => textW(formatChartValue(v), 10))) + 8 : 0;
    const right = W - 28 - tipW;
    const plotTop = top + 4;
    const footer = 26 + (valTitle ? 26 : 0) + 8;
    // Rows stretch to fill a taller canvas, up to 48px each.
    const rowH = Math.max(24, nSeries * 12 + 12, Math.min(48, (size.height - plotTop - footer) / n));
    const plotH = n * rowH;
    const bottom = plotTop + plotH;
    const H = bottom + footer;
    const sx = v => left + (v - vs.lo) / (vs.hi - vs.lo) * (right - left);
    vs.ticks.forEach((t, i) => {
      const x = sx(t);
      out += `<line x1="${f1(x)}" y1="${plotTop}" x2="${f1(x)}" y2="${bottom}" stroke="${t === 0 ? theme.axis : theme.grid}" stroke-width="1"></line>`;
      out += svgText(x, bottom + 16, tickLabels[i], { size: 11, fill: theme.text2, anchor: 'middle' });
    });
    const thick = Math.min(24, (rowH * 0.72 - (nSeries - 1) * 2) / nSeries);
    data.categories.forEach((cat, i) => {
      const y0 = plotTop + i * rowH;
      const groupH = nSeries * thick + (nSeries - 1) * 2;
      let tip = `${cat}`;
      let bars = '';
      data.series.forEach((s, k) => {
        const v = s.values[i];
        tip += `\n${s.name}: ${formatChartValue(v)}`;
        if (v === null) return;
        const y = y0 + (rowH - groupH) / 2 + k * (thick + 2);
        const x0 = sx(0), x1 = sx(v);
        bars += `<path class="chart-mark" d="${barPath(Math.min(x0, x1), y, Math.abs(x1 - x0), thick, v >= 0 ? 'right' : 'left')}" fill="${theme.series[k % theme.series.length]}"></path>`;
        if (tipLabels) out += svgText(v >= 0 ? x1 + 5 : x1 - 5, y + thick / 2 + 4, formatChartValue(v), { size: 10, fill: theme.text2, anchor: v >= 0 ? 'start' : 'end' });
      });
      out += `<g><title>${escapeXml(tip)}</title><rect x="${left}" y="${f1(y0)}" width="${right - left}" height="${rowH}" fill="transparent"></rect>${bars}</g>`;
      out += svgText(left - 8, y0 + rowH / 2 + 4, catLabels[i], { size: 11, fill: theme.text2, anchor: 'end' });
    });
    out += `<line x1="${left}" y1="${plotTop}" x2="${left}" y2="${bottom}" stroke="${theme.axis}" stroke-width="1"></line>`;
    if (catTitle) out += svgText(28, plotTop + plotH / 2, catTitle, { size: 12, fill: theme.text2, anchor: 'middle', rotate: -90, weight: 500, edit: 'xAxisTitle' });
    if (valTitle) out += svgText((left + right) / 2, bottom + 44, valTitle, { size: 12, fill: theme.text2, anchor: 'middle', weight: 500, edit: 'yAxisTitle' });
    return wrapSvg(W, H, theme, header + out);
  }

  // Vertical layouts: column / line / area / scatter.
  const yLabelW = Math.max(...tickLabels.map(l => textW(l, 11)));
  const left = 20 + (valTitle ? 22 : 0) + yLabelW + 10;
  const right = W - 28;
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
    const band = plotW / n;
    const maxLabelW = Math.max(...catLabels.map(l => textW(l, 11)), 1);
    if (maxLabelW > band - 6) {
      // Rotated -40deg labels need ~26px of horizontal room each to
      // not overlap; thin them to every Nth category past that.
      rotate = true;
      every = Math.max(1, Math.ceil(n / Math.floor(plotW / 26)));
      xLabelArea = Math.min(maxLabelW, textW('x'.repeat(18), 11)) * 0.66 + 22;
    }
  }
  const plotTop = top + 4;
  const H = Math.max(size.height, plotTop + options.minPlotHeight + xLabelArea + (catTitle ? 28 : 0));
  const bottom = H - xLabelArea - (catTitle ? 28 : 0) - 10;
  const sy = v => bottom - (v - vs.lo) / (vs.hi - vs.lo) * (bottom - plotTop);

  vs.ticks.forEach((t, i) => {
    const y = sy(t);
    out += `<line x1="${left}" y1="${f1(y)}" x2="${right}" y2="${f1(y)}" stroke="${t === 0 ? theme.axis : theme.grid}" stroke-width="1"></line>`;
    out += svgText(left - 8, y + 4, tickLabels[i], { size: 11, fill: theme.text2, anchor: 'end' });
  });
  if (valTitle) out += svgText(28, (plotTop + bottom) / 2, valTitle, { size: 12, fill: theme.text2, anchor: 'middle', rotate: -90, weight: 500, edit: 'yAxisTitle' });
  if (catTitle) out += svgText((left + right) / 2, H - 14, catTitle, { size: 12, fill: theme.text2, anchor: 'middle', weight: 500, edit: 'xAxisTitle' });

  if (scatter) {
    const sx = v => left + (v - xs.lo) / (xs.hi - xs.lo) * plotW;
    xs.ticks.forEach(t => {
      const x = sx(t);
      out += `<line x1="${f1(x)}" y1="${plotTop}" x2="${f1(x)}" y2="${bottom}" stroke="${theme.grid}" stroke-width="1"></line>`;
      out += svgText(x, bottom + 16, formatTick(t, xs.step), { size: 11, fill: theme.text2, anchor: 'middle' });
    });
    data.points.forEach(p => {
      p.ys.forEach((y, k) => {
        if (y === null) return;
        out += `<circle class="chart-mark" cx="${f1(sx(p.x))}" cy="${f1(sy(y))}" r="4.5" fill="${theme.series[k % theme.series.length]}" stroke="${theme.surface}" stroke-width="2"><title>${escapeXml(`${data.series[k].name}: ${formatChartValue(y)}\n${catTitle || 'X'}: ${formatChartValue(p.x)}`)}</title></circle>`;
      });
    });
    return wrapSvg(W, H, theme, header + out);
  }

  const n = data.categories.length;
  const band = plotW / n;
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

  if (spec.type === 'column') {
    const thick = Math.min(24, (band * 0.72 - (nSeries - 1) * 2) / nSeries);
    const groupW = nSeries * thick + (nSeries - 1) * 2;
    data.series.forEach((s, k) => {
      s.values.forEach((v, i) => {
        if (v === null) return;
        const x = left + band * i + (band - groupW) / 2 + k * (thick + 2);
        const y0 = sy(0), y1 = sy(v);
        out += `<path class="chart-mark" d="${barPath(x, Math.min(y0, y1), thick, Math.abs(y1 - y0), v >= 0 ? 'up' : 'down')}" fill="${theme.series[k % theme.series.length]}"></path>`;
        if (nSeries === 1 && n <= 20) out += svgText(x + thick / 2, v >= 0 ? y1 - 6 : y1 + 14, formatChartValue(v), { size: 10, fill: theme.text2, anchor: 'middle' });
      });
    });
    return wrapSvg(W, H, theme, header + out + hover);
  }

  // line / area
  const markers = n <= 40;
  data.series.forEach((s, k) => {
    const color = theme.series[k % theme.series.length];
    const pts = s.values.map((v, i) => v === null ? null : [cx(i), sy(v)]);
    const segments = [];
    let cur = [];
    pts.forEach(p => { if (p) cur.push(p); else if (cur.length) { segments.push(cur); cur = []; } });
    if (cur.length) segments.push(cur);
    segments.forEach(seg => {
      const d = seg.map((p, j) => `${j ? 'L' : 'M'}${f1(p[0])},${f1(p[1])}`).join('');
      if (spec.type === 'area') {
        const base = sy(Math.max(vs.lo, Math.min(0, vs.hi)));
        out += `<path d="${d}L${f1(seg[seg.length - 1][0])},${f1(base)}L${f1(seg[0][0])},${f1(base)}Z" fill="${color}" fill-opacity="0.12"></path>`;
      }
      out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></path>`;
    });
    if (markers) pts.forEach(p => { if (p) out += `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="4" fill="${color}" stroke="${theme.surface}" stroke-width="2"></circle>`; });
    const lastIdx = s.values.map((v, i) => v === null ? -1 : i).filter(i => i >= 0).pop();
    if (nSeries === 1 && lastIdx !== undefined) {
      out += svgText(pts[lastIdx][0], pts[lastIdx][1] - 10, formatChartValue(s.values[lastIdx]), { size: 10, fill: theme.text2, anchor: 'middle', weight: 600 });
    }
  });
  return wrapSvg(W, H, theme, header + out + hover);
}

function relativeLuminance(hex) {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(i => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Legend beside the pie on a wide canvas (synth-sql's only layout, drawn at
// 760px+); below it on a narrow one, where a side legend has no room for
// its labels — dashboard tiles are often a third of that width.
const PIE_STACK_BELOW = 480;

function renderPieSVG(spec, data, theme, size, options) {
  const W = size.width;
  const [header, top] = renderChartHeader(spec, data, theme, W, [], options);
  const values = data.series[0].values.map(v => v || 0);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const stacked = W < PIE_STACK_BELOW;
  let H = Math.max(options.minPieHeight, size.height);
  const legendW = stacked ? W - 48 : Math.min(380, Math.max(150, W * 0.42));
  const legendRowH = stacked ? 24 : 30;
  let r, cx, cy, lx, ly0;
  if (stacked) {
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
    const color = theme.series[i % theme.series.length];
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
    out += `<path class="chart-mark" d="${d}" fill="${color}" fill-rule="evenodd" stroke="${theme.surface}" stroke-width="2"><title>${escapeXml(`${data.categories[i]}: ${formatChartValue(v)} (${pct.toFixed(1)}%)`)}</title></path>`;
    if (pct >= 6) {
      const [lx, ly] = pt((a0 + a1) / 2, inner ? (r + inner) / 2 : r * 0.64);
      const ink = relativeLuminance(color) > 0.35 ? '#0e0f0c' : '#ffffff';
      out += svgText(lx, ly + 4, `${Math.round(pct)}%`, { size: 11, fill: ink, anchor: 'middle', weight: 600 });
    }
  });
  if (inner) {
    out += svgText(cx, cy - 2, formatChartValue(total), { size: 20, fill: theme.text, anchor: 'middle', weight: 600 });
    out += svgText(cx, cy + 18, clip(spec.yAxisTitle || 'Total', 22), { size: 11, fill: theme.text2, anchor: 'middle' });
  }
  const legendRight = Math.min(W - 24, lx + legendW);
  values.forEach((v, i) => {
    const y = ly0 + i * legendRowH;
    const valueText = `${formatChartValue(v)}  ·  ${(v / total * 100).toFixed(1)}%`;
    // Label gets whatever room the value text leaves, never overlapping it.
    const labelRoom = legendRight - textW(valueText, 12) - 12 - (lx + 20);
    out += `<rect x="${f1(lx)}" y="${f1(y - 10)}" width="12" height="12" rx="2" fill="${theme.series[i % theme.series.length]}"></rect>`;
    out += svgText(lx + 20, y, clip(data.categories[i], Math.max(4, Math.floor(labelRoom / (12 * 0.58)))), { size: 12, fill: theme.text });
    out += svgText(legendRight, y, valueText, { size: 12, fill: theme.text2, anchor: 'end' });
  });
  return wrapSvg(W, H, theme, header + out);
}

function wrapSvg(W, H, theme, body) {
  const family = escapeXml(theme.fontFamily || 'Inter, system-ui, sans-serif');
  return `<svg viewBox="0 0 ${W} ${f1(H)}" xmlns="http://www.w3.org/2000/svg" font-family="${family}" role="img">
    <rect x="0" y="0" width="${W}" height="${f1(H)}" fill="${theme.surface}"></rect>${body}</svg>`;
}

const DEFAULT_RENDER_OPTIONS = { showTitle: true, minPlotHeight: 300, minPieHeight: 420 };

export function renderChartSVG(spec, data, theme, size = { width: 760, height: 420 }, options = {}) {
  const opts = { ...DEFAULT_RENDER_OPTIONS, ...options };
  if (spec.type === 'pie' || spec.type === 'doughnut') return renderPieSVG(spec, data, theme, size, opts);
  return renderCartesianSVG(spec, data, theme, size, opts);
}
