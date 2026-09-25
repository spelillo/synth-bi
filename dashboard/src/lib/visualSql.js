// dashboard/src/lib/visualSql.js — the TileEditor's Visual mode: turns a
// { table, groupBy, dateGrain, splitBy, agg, measure, filter } pick into the SQL the
// tile actually runs (BUILD-INSTRUCTIONS.md §5.3). The generated query is
// always shown to the user read-only and becomes the starting point if they
// switch to SQL mode, so it's written to be readable, not just correct:
// quoted identifiers, one clause per line, friendly column aliases that
// chart-engine's prettifyColumnName() turns into good axis titles
// ("total_revenue" -> "Total Revenue").
//
// Every column is stored as TEXT (app.js loadFileAsTable), so numeric
// aggregates CAST explicitly; thousands separators were already stripped at
// load time (csv-parser.js normalizeThousandsSeparators).

export const AGGREGATES = [
  { id: 'count', label: 'Count of rows', needsColumn: false },
  { id: 'count_distinct', label: 'Count distinct', needsColumn: true, anyKind: true },
  { id: 'sum', label: 'Sum', needsColumn: true },
  { id: 'avg', label: 'Average', needsColumn: true },
  { id: 'min', label: 'Minimum', needsColumn: true },
  { id: 'max', label: 'Maximum', needsColumn: true },
];

export const DATE_GRAINS = [
  { id: 'none', label: 'Exact value' },
  { id: 'year', label: 'Year' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'month', label: 'Month' },
  { id: 'day', label: 'Day' },
];

export const FILTER_OPS = [
  { id: 'eq', label: 'is', needsValue: true },
  { id: 'neq', label: 'is not', needsValue: true },
  { id: 'gt', label: '>', needsValue: true, numericOnly: true },
  { id: 'gte', label: '≥', needsValue: true, numericOnly: true },
  { id: 'lt', label: '<', needsValue: true, numericOnly: true },
  { id: 'lte', label: '≤', needsValue: true, numericOnly: true },
  { id: 'contains', label: 'contains', needsValue: true },
  { id: 'empty', label: 'is empty', needsValue: false },
  { id: 'notEmpty', label: 'is not empty', needsValue: false },
];

export const quoteIdent = name => `"${String(name).replace(/"/g, '""')}"`;
const quoteString = value => `'${String(value).replace(/'/g, "''")}'`;
const aliasSafe = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'value';
const NUMERIC_LITERAL_RE = /^-?\d+(\.\d+)?$/;

function columnOf(table, name) {
  return table.columns.find(c => c.name === name) || null;
}

// A sensible first pick for a freshly opened editor: group by the first
// date or text column (by month, for an ISO date), measure the first
// numeric column that isn't an id.
export function defaultVisual(table) {
  if (!table) return null;
  const idLike = name => /(^|_)id$|^id_|uuid|zip|postal|phone/i.test(name);
  const date = table.columns.find(c => c.kind === 'date');
  const text = table.columns.find(c => c.kind === 'text' && !idLike(c.name));
  const group = text || date || null;
  const measure = table.columns.find(c => c.kind === 'numeric' && !idLike(c.name));
  return {
    table: table.name,
    groupBy: group ? group.name : '',
    dateGrain: group && group.kind === 'date' && group.isoDate ? 'month' : 'none',
    splitBy: '',
    agg: measure ? 'sum' : 'count',
    measure: measure ? measure.name : '',
    filter: { column: '', op: 'eq', value: '' },
  };
}

// Repairs a visual pick against the current schema (a column may have
// been removed, or a table renamed) — returns null if the table is gone.
export function reconcileVisual(visual, schema) {
  const table = schema.find(t => t.name === visual.table);
  if (!table) return null;
  const has = name => !!columnOf(table, name);
  const agg = AGGREGATES.find(a => a.id === visual.agg) ? visual.agg : 'count';
  const measureOk = has(visual.measure) && (agg === 'count_distinct' || columnOf(table, visual.measure).kind === 'numeric' || agg === 'min' || agg === 'max');
  const filter = visual.filter && has(visual.filter.column) ? visual.filter : { column: '', op: 'eq', value: '' };
  return {
    table: table.name,
    groupBy: has(visual.groupBy) ? visual.groupBy : '',
    dateGrain: DATE_GRAINS.find(g => g.id === visual.dateGrain) ? visual.dateGrain : 'none',
    splitBy: has(visual.splitBy) && visual.splitBy !== visual.groupBy ? visual.splitBy : '',
    agg: measureOk || agg === 'count' ? agg : 'count',
    measure: measureOk ? visual.measure : '',
    filter,
  };
}

function groupExpression(col, grain) {
  const c = quoteIdent(col.name);
  if (!col.isoDate || grain === 'none') return { expr: c, alias: null };
  switch (grain) {
    case 'year': return { expr: `substr(${c}, 1, 4)`, alias: 'year' };
    case 'month': return { expr: `substr(${c}, 1, 7)`, alias: 'month' };
    case 'day': return { expr: `substr(${c}, 1, 10)`, alias: 'day' };
    case 'quarter': return { expr: `substr(${c}, 1, 4) || '-Q' || ((CAST(substr(${c}, 6, 2) AS INTEGER) + 2) / 3)`, alias: 'quarter' };
    default: return { expr: c, alias: null };
  }
}

function measureExpression(table, agg, measureName) {
  if (agg === 'count' || !measureName) return { expr: 'COUNT(*)', alias: 'row_count' };
  const col = columnOf(table, measureName);
  const c = quoteIdent(measureName);
  const a = aliasSafe(measureName);
  const numeric = col && col.kind === 'numeric';
  const num = `CAST(${c} AS REAL)`;
  switch (agg) {
    case 'count_distinct': return { expr: `COUNT(DISTINCT ${c})`, alias: `distinct_${a}` };
    case 'sum': return { expr: `SUM(${num})`, alias: `total_${a}` };
    case 'avg': return { expr: `ROUND(AVG(${num}), 2)`, alias: `average_${a}` };
    case 'min': return { expr: `MIN(${numeric ? num : c})`, alias: `min_${a}` };
    case 'max': return { expr: `MAX(${numeric ? num : c})`, alias: `max_${a}` };
    default: return { expr: 'COUNT(*)', alias: 'row_count' };
  }
}

function filterClause(table, filter) {
  if (!filter || !filter.column) return null;
  const col = columnOf(table, filter.column);
  if (!col) return null;
  const op = FILTER_OPS.find(o => o.id === filter.op) || FILTER_OPS[0];
  const c = quoteIdent(col.name);
  const value = String(filter.value ?? '').trim();
  if (op.id === 'empty') return `(${c} IS NULL OR ${c} = '')`;
  if (op.id === 'notEmpty') return `(${c} IS NOT NULL AND ${c} <> '')`;
  if (!value) return null;
  if (op.id === 'contains') return `${c} LIKE ${quoteString(`%${value}%`)}`;
  const numericCompare = col.kind === 'numeric' && NUMERIC_LITERAL_RE.test(value);
  const lhs = numericCompare ? `CAST(${c} AS REAL)` : c;
  const rhs = numericCompare ? value : quoteString(value);
  const sym = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op.id];
  return `${lhs} ${sym} ${rhs}`;
}

// Returns the SQL for a visual pick, or '' if it can't be built yet.
export function buildVisualSql(visual, schema) {
  if (!visual) return '';
  const table = schema.find(t => t.name === visual.table);
  if (!table) return '';

  const measure = measureExpression(table, visual.agg, visual.measure);
  const where = filterClause(table, visual.filter);
  const groupCol = visual.groupBy ? columnOf(table, visual.groupBy) : null;
  const lines = [];

  if (groupCol) {
    const group = groupExpression(groupCol, visual.dateGrain);
    const groupSelect = group.alias ? `${group.expr} AS ${group.alias}` : group.expr;
    // "Split by" adds a second grouping column — the chart pivots it into
    // one series per value (Power BI's Legend well).
    const splitCol = visual.splitBy && visual.splitBy !== visual.groupBy ? columnOf(table, visual.splitBy) : null;
    const split = splitCol ? quoteIdent(splitCol.name) : null;
    const measureAlias = measure.alias === group.alias ? `${measure.alias}_value` : measure.alias;
    lines.push(`SELECT ${groupSelect}, ${split ? `${split}, ` : ''}${measure.expr} AS ${measureAlias}`);
    lines.push(`FROM ${quoteIdent(table.name)}`);
    if (where) lines.push(`WHERE ${where}`);
    lines.push(`GROUP BY ${group.expr}${split ? `, ${split}` : ''}`);
    // Time reads left to right; everything else ranks biggest first, so a
    // high-cardinality group-by still charts its top rows.
    const temporal = groupCol.kind === 'date' || /(year|month|quarter|week|date|day|period)/i.test(groupCol.name);
    lines.push(temporal ? `ORDER BY ${group.expr}${split ? `, ${split}` : ''}` : `ORDER BY ${measureAlias} DESC`);
  } else {
    lines.push(`SELECT ${measure.expr} AS ${measure.alias}`);
    lines.push(`FROM ${quoteIdent(table.name)}`);
    if (where) lines.push(`WHERE ${where}`);
  }
  return lines.join('\n');
}
