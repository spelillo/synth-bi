// dashboard/src/lib/rebuildGuide.js — the written half of the export bundle:
//   - buildVizTables: each chart tile's query result, typed for the Excel writer
//   - buildRebuildGuide: rebuild-guide.md, one section per visual with steps
//     for both Power BI and Tableau. The AI's per-tile guide (schema + SQL
//     only, never row values) is used when it came back; otherwise a
//     template built from the tile's chart spec fills in, so the bundle is
//     complete offline or when the AI is rate-limited.
//   - buildReadme: README.md, the map of what's in the zip.

const POWER_BI = {
  column: 'Clustered column chart', bar: 'Clustered bar chart', stackedColumn: 'Stacked column chart', stackedBar: 'Stacked bar chart',
  percentColumn: '100% stacked column chart', percentBar: '100% stacked bar chart', combo: 'Line and clustered column chart',
  waterfall: 'Waterfall chart', line: 'Line chart', area: 'Area chart', stackedArea: 'Stacked area chart', pie: 'Pie chart',
  doughnut: 'Donut chart', treemap: 'Treemap', funnel: 'Funnel', scatter: 'Scatter chart', bubble: 'Scatter chart (with a Size field)',
  histogram: 'Clustered column chart over a binned field', heatmap: 'Matrix (with conditional-format background colors)', radar: 'no built-in radar — use a Line chart or the Radar Chart custom visual from AppSource',
  kpi: 'Card (or KPI visual for value + trend)', gauge: 'Gauge', table: 'Table', auto: 'the chart type that fits the fields',
};
const TABLEAU = {
  column: 'Bar (vertical)', bar: 'Bar (horizontal)', stackedColumn: 'Stacked bar (vertical), split by Color', stackedBar: 'Stacked bar (horizontal), split by Color',
  percentColumn: 'Stacked bar with Table Calculation > Percent of Total', percentBar: 'Stacked bar with Table Calculation > Percent of Total', combo: 'Dual axis: Bar + Line',
  waterfall: 'Gantt bar with a running-total calculation', line: 'Line', area: 'Area', stackedArea: 'Area, split by Color', pie: 'Pie', doughnut: 'Pie with a dual-axis white circle',
  treemap: 'Treemap', funnel: 'Bar sorted descending, centered with a dual axis', scatter: 'Circle / Shape', bubble: 'Circle with Size', histogram: 'Histogram (Show Me)',
  heatmap: 'Highlight table / Square', radar: 'no built-in radar — use a Line (polar path) or a Bar', kpi: 'Text (big number on Label)', gauge: 'Bullet graph or a dual-axis donut', table: 'Text table', auto: 'the mark that fits the fields',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;

function inferColumn(name, rows, j) {
  let numeric = true, integer = true, iso = true, dateOnly = true, seen = 0;
  for (const r of rows) {
    const v = r[j];
    if (v === null || v === undefined || v === '') continue;
    seen++;
    const s = String(v);
    if (numeric && (typeof v === 'number' || (s.trim() !== '' && !isNaN(Number(s))))) { if (!Number.isInteger(Number(s))) integer = false; } else numeric = false;
    if (iso) {
      if (ISO_DATE.test(s)) { /* date only */ } else if (ISO_DATETIME.test(s)) dateOnly = false; else iso = false;
    }
    if (!numeric && !iso) break;
  }
  if (!seen) return { name, kind: 'text' };
  if (numeric) return { name, kind: 'numeric', integer };
  if (iso) return { name, kind: 'date', isoDate: true, dateOnly };
  return { name, kind: 'text' };
}

const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'viz';

// chartTiles: the non-text tiles, in dashboard order. Each result is
// { id, number, title, fileName, tableName, columns, rows } or, when the
// tile's query fails or is empty, { ..., error }.
export function buildVizTables(chartTiles, titleOf, runQuery) {
  return chartTiles.map((tile, i) => {
    const number = String(i + 1).padStart(2, '0');
    const title = titleOf(tile);
    const base = { id: tile.id, number, title, fileName: `${number}-${slugify(title)}.xlsx`, tableName: `viz_${number}_${slugify(title).replace(/-/g, '_')}` };
    try {
      const result = runQuery(tile.sql, { maxRows: 200000 });
      if (!result.columns.length || !result.rows.length) return { ...base, error: 'The query returned no rows.' };
      return { ...base, columns: result.columns.map((c, j) => inferColumn(c, result.rows, j)), rows: result.rows, truncated: result.truncated };
    } catch (err) {
      return { ...base, error: err.message || String(err) };
    }
  });
}

// What the AI is allowed to see about a tile: no data, only its spec + SQL.
export function tilesForGuide(chartTiles, titleOf) {
  return chartTiles.map(t => {
    const spec = t.chartSpec || {};
    return { id: t.id, title: titleOf(t), type: spec.type || 'auto', category: spec.category || null, values: spec.values || [], seriesBy: spec.seriesBy || null, sql: t.sql };
  });
}

function templateGuide(t) {
  const wellsPbi = [];
  const wellsTab = [];
  if (t.category) { wellsPbi.push(`Put **${t.category}** in the Axis (or Category) well.`); wellsTab.push(`Drag **${t.category}** to Columns (or Rows for horizontal bars).`); }
  if (t.values.length) { wellsPbi.push(`Put ${t.values.map(v => `**${v}**`).join(', ')} in the Values well.`); wellsTab.push(`Drag ${t.values.map(v => `**${v}**`).join(', ')} to Rows (as measures).`); }
  if (t.seriesBy) { wellsPbi.push(`Put **${t.seriesBy}** in the Legend well.`); wellsTab.push(`Drag **${t.seriesBy}** to Color.`); }
  return {
    summary: `A ${t.type} chart built from the query below.`,
    sources: [],
    logic: 'See the SQL below for the exact filters, grouping and aggregation.',
    powerBi: { visual: POWER_BI[t.type] || POWER_BI.auto, steps: wellsPbi },
    tableau: { mark: TABLEAU[t.type] || TABLEAU.auto, steps: wellsTab },
  };
}

const list = steps => (steps.length ? steps.map((s, i) => `${i + 1}. ${String(s).replace(/^\d+[.)]\s*/, '')}`).join('\n') : '_Add the fields to the wells shown in the visual\'s Fields pane._');

// items: tilesForGuide() output; viz: buildVizTables() output; guides: the
// AI's { [id]: guide } (possibly empty).
export function buildRebuildGuide({ dashboardName, items, viz, guides, aiUsed }) {
  const out = [
    `# How to rebuild "${dashboardName}"`,
    '',
    aiUsed
      ? 'Each section below says what a visual shows, where its data comes from, and how to recreate it in Power BI and in Tableau. The instructions were drafted by Synth-BI\'s assistant from your tile settings and SQL (it never saw your row values) — treat them as a very good starting point.'
      : 'Each section below lists a visual\'s fields and SQL and how to recreate it in Power BI and in Tableau. (The assistant was not available for this export, so these are template instructions from each tile\'s settings.)',
    '',
    '`dashboard.png` shows the layout to match. Every visual\'s exact data is in `viz-data/`, so the quickest route is: import that workbook, then drop the fields in the wells named below.',
    '',
  ];
  items.forEach((t, i) => {
    const v = viz[i];
    const g = { ...templateGuide(t), ...(guides[String(t.id)] || {}) };
    const pbi = { ...templateGuide(t).powerBi, ...(g.powerBi || {}) };
    const tab = { ...templateGuide(t).tableau, ...(g.tableau || {}) };
    out.push(`## ${v.number}. ${t.title}`, '');
    out.push(`**What it shows:** ${g.summary}`, '');
    out.push(`**Chart in Synth-BI:** ${t.type}${t.category ? ` · category: \`${t.category}\`` : ''}${t.values.length ? ` · values: ${t.values.map(x => `\`${x}\``).join(', ')}` : ''}${t.seriesBy ? ` · split by: \`${t.seriesBy}\`` : ''}`, '');
    if (g.sources && g.sources.length) out.push(`**Source data:** ${g.sources.map(s => `\`${s}.xlsx\``).join(', ')}`, '');
    out.push(`**This visual's data:** ${v.error ? `not exported (${v.error})` : `\`viz-data/${v.fileName}\` — ${v.rows.length.toLocaleString()} rows, Excel Table \`${v.tableName}\`${v.truncated ? ' (first 200,000 rows)' : ''}`}`, '');
    if (g.logic) out.push(`**How the numbers are made:** ${g.logic}`, '');
    out.push(`### Power BI — ${pbi.visual}`, '', list(pbi.steps || []), '');
    out.push(`### Tableau — ${tab.mark}`, '', list(tab.steps || []), '');
    out.push('<details><summary>SQL</summary>', '', '```sql', String(t.sql).trim(), '```', '', '</details>', '');
  });
  if (!items.length) out.push('_This dashboard has no chart tiles yet._', '');
  return out.join('\n');
}

export function buildReadme({ dashboardName, tables, viz, image, tableau, textTiles }) {
  const L = [`# ${dashboardName}`, '', 'Exported from Synth-BI. Your data never left your browser: these files were generated on your computer.', '', '## What\'s in this folder', ''];
  if (image) L.push('- `dashboard.png` — the dashboard as it looked when exported (the layout to match).');
  L.push('- `rebuild-guide.md` — for every visual: what it shows, where the data comes from, and step-by-step instructions for Power BI and Tableau.');
  const ok = viz.filter(v => !v.error);
  if (ok.length) L.push(`- \`viz-data/\` — ${ok.length} Excel workbook${ok.length === 1 ? '' : 's'}, one per visual, holding exactly the rows that visual plots.`);
  if (tables.length) L.push(`- \`*.xlsx\` (top level) — the ${tables.length} source table${tables.length === 1 ? '' : 's'}: ${tables.map(t => `${t.name} (${t.rowCount.toLocaleString()} rows)`).join(', ')}.`);
  if (tableau && tables.length) L.push('- `*.tds` — a Tableau data source for each source table; keep it next to its .xlsx.');
  if (textTiles) L.push(`- The ${textTiles} text box${textTiles === 1 ? '' : 'es'} on the dashboard ${textTiles === 1 ? 'is' : 'are'} visible in the image; recreate ${textTiles === 1 ? 'it' : 'them'} with a Text box (Power BI) or Text object (Tableau).`);
  L.push('', '## Quick start', '',
    '**Power BI:** Home > Get Data > Excel workbook > pick a `viz-data` file > tick the Table (not the sheet) > Load. Then follow that visual\'s section in `rebuild-guide.md`.', '',
    '**Tableau:** Connect > Microsoft Excel > pick a `viz-data` file, drag its sheet in, then follow that visual\'s section. Or double-click a `.tds` to open a source table already typed.', '');
  return L.join('\n');
}
