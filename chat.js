// chat.js — ported from synth-sql's chat.js pattern: schema-only system
// prompt (never row values), Groq via /api/chat, same rate-limit boundary,
// same session-token handshake and error handling. What's different:
//
// 1. Two modes, toggled in the AI panel (same visual pattern as synth-sql's
//    SQL/General toggle):
//    - Ask: questions about the data, the dashboard, and how to build a
//      visual in Synth-BI. When an answer needs actual numbers, the model
//      writes a query; it runs *locally* (bridge.runQuery) and its result is
//      shown under the reply. The result never goes back to the model — the
//      boundary stays schema-only, exactly like synth-sql's General Mode.
//    - Build: describe the visual you want (fields, chart type, colors, a
//      title...). The model returns a structured tile draft; it's validated
//      by running its SQL locally (one automatic repair round if it fails),
//      then the island opens it in the tile editor as a preview to fine-tune
//      before it's added. It can also target an existing tile ("make the
//      revenue chart a line") or add a text box.
//    (This Build flow is the user-decided replacement for the docs'
//    act-freely Agent Mode, initial-build.md §6: a preview step always
//    comes before anything lands on the dashboard.)
//
// 2. The system prompt describes every table in the workspace (same
//    multi-table framing synth-sql uses for joins), confirmed relationships,
//    and a compact summary of the dashboard's current tiles (titles, types,
//    SQL — never data), so follow-ups like "make the last one a line chart"
//    resolve.
//
// The island calls this through window.synthBridge.sendAiMessage().

const CHAT_ENDPOINT = '/api/chat';
const AI_MODEL = 'openai/gpt-oss-120b';
const HISTORY_TURNS = 8;

const AI_CHART_TYPES = [
  'column', 'bar', 'stackedColumn', 'stackedBar', 'percentColumn', 'percentBar', 'combo', 'waterfall',
  'line', 'area', 'stackedArea', 'pie', 'doughnut', 'treemap', 'funnel',
  'scatter', 'bubble', 'histogram', 'heatmap', 'radar', 'kpi', 'gauge', 'table',
];
const AI_PALETTES = ['synth', 'forest', 'ocean', 'sunset', 'classic', 'powerbi', 'tableau', 'mono'];

// ---- Prompt context (schema + relationships + tiles; never row values) ----

function schemaPromptText() {
  return tables.map(t => {
    const cols = (t.columnInfo || t.columns.map(name => ({ name, kind: 'text' }))).map(c => {
      const detail = c.kind === 'numeric' ? (c.integer ? 'number, whole' : 'number') : c.kind === 'date' ? (c.isoDate ? 'date, ISO yyyy-mm-dd' : 'date, not ISO') : 'text';
      return `  - ${c.name} (${detail})`;
    }).join('\n');
    const src = t.sourceType === 'xlsx' ? ` — Excel sheet "${t.sheetName}"` : '';
    return `Table ${t.name} (${t.rowCount.toLocaleString()} rows${src})\n${cols}`;
  }).join('\n\n');
}

function tilesPromptText() {
  if (!dashboardTiles.length) return 'The dashboard is empty so far.';
  return dashboardTiles.map(t => {
    if (t.kind === 'text') return `- id ${t.id}: text box — "${String(t.text || '').split('\n')[0].slice(0, 80)}"`;
    const spec = t.chartSpec || {};
    const sql = String(t.sql || '').replace(/\s+/g, ' ').slice(0, 320);
    return `- id ${t.id}: ${spec.type || 'auto'} chart, title "${spec.title || '(auto)'}"; SQL: ${sql}`;
  }).join('\n');
}

const SQL_RULES = `SQL rules (SQLite, runs in the user's browser):
- Only read-only queries: a single SELECT (or WITH ... SELECT). Never modify data.
- Use table names exactly as listed, unquoted. Wrap column names in double quotes ("Order_Date").
- Every column is stored as TEXT. CAST("col" AS REAL) before any math, SUM/AVG/MIN/MAX on numbers, or numeric comparison.
- ISO date columns: group by month with substr("col", 1, 7), by year with substr("col", 1, 4), by day with substr("col", 1, 10).
- Give computed columns short snake_case aliases (total_revenue, order_count) — they become axis titles.
- For a series split (one line/stack per value), return long rows: category column, split column, value column.
- Use single quotes for string literals. Join tables on the relationships listed when relevant.`;

function contextBlock() {
  const rel = typeof relationshipHintsText === 'function' ? relationshipHintsText() : '';
  return `The user's data (schema only — you never see row values):\n\n${schemaPromptText()}\n${rel}\nCurrent dashboard tiles:\n${tilesPromptText()}`;
}

const APP_GUIDE = `How Synth-BI works (use this for how-to questions):
- "Add tile" opens the tile editor. Data tab: Visual mode picks a table, Group by (with Year/Quarter/Month/Day for dates), Split by (legend), a Measure (Count, Count distinct, Sum, Average, Min, Max of a column) and an optional Filter — the SQL it writes is shown underneath; SQL mode lets them write the query. Visual tab: 22 chart types (column, bar, stacked and 100% stacked, column+line combo, waterfall, line, area, stacked area, pie, doughnut, treemap, funnel, scatter, bubble, histogram, heatmap, radar, KPI card, gauge, table) plus field wells. Format tab: palette, per-series colors, data labels, legend, gridlines, smooth lines, number format, tile title/subtitle/background/outline.
- Tiles move by dragging their title bar and resize from their edges/corner. "Text" adds a text box (sizes up to a big title, bold/italic, alignment, colors; supports # headings and - bullets). "Style" sets the canvas background, free vs. snap-up layout, spacing, and tile corners.
- Table View browses any table; the Relationships tab confirms how tables join.
- Export (signed in) downloads Excel tables for Power BI, a Tableau data source (.tds), and a dashboard image.
- Build mode in this panel: describe a visual and the assistant drafts it, then opens it in the editor to fine-tune before adding.`;

function askSystemPrompt() {
  return `You are the data assistant inside Synth-BI, a dashboard builder that runs entirely in the user's browser.

${contextBlock()}

${APP_GUIDE}

How to answer:
1. Questions about the data that need real numbers ("which region sold the most?", "average order size by month"): write ONE query in a \`\`\`sql code block. The app runs it locally and shows the result right under your reply — you will NOT see the result, so never state or guess the numbers. Say briefly what the query computes (e.g. "This totals revenue per region, highest first — the result is below.").
2. Questions about structure (what columns exist, how tables relate, what a column likely means): answer from the schema above.
3. How-to questions (making a chart, changing colors, adding a title): give short, concrete steps using the app guide above, and suggest a chart type when helpful. Mention that Build mode can draft it for them.
4. Be concise: a few sentences or a short bullet list. Markdown is fine (bold, bullets, inline code).
5. If the question is unrelated to data, dashboards, or this app, reply with one line saying you can help with their data and dashboard.

${SQL_RULES}`;
}

function buildSystemPrompt() {
  return `You design dashboard tiles for Synth-BI, a dashboard builder that runs in the user's browser. You only see schema, never row values.

${contextBlock()}

Reply with ONLY a JSON object (no prose, no code fence) in this shape:
{
  "action": "tile" | "text" | "clarify",
  "message": "1-2 friendly sentences for the chat: what you built and any assumption you made",
  "tile": {
    "targetTileId": "id of an existing tile when the user asks to change one, else null",
    "sql": "one read-only SQLite query",
    "chart": {
      "type": "${AI_CHART_TYPES.join('|')}",
      "title": "Title Case, under 60 chars, business-friendly",
      "category": "result column for the x axis / slices / groups, or null",
      "values": ["numeric result column", "..."],
      "seriesBy": "result column to split into one series per value (legend), or null",
      "size": "numeric result column for bubble size, or null",
      "xAxisTitle": "", "yAxisTitle": "",   (leave both "" unless the user names them; xAxisTitle always labels the category axis and yAxisTitle the value axis, even on horizontal bars)
      "style": {
        "palette": "${AI_PALETTES.join('|')} or null for the default green",
        "colors": ["#hex per series (or per slice for pie/doughnut/treemap), only when the user asks for colors"],
        "dataLabels": "auto|on|off", "legend": true, "gridlines": true, "smooth": false,
        "format": "auto|compact|currency|percent|integer|decimal", "varyColors": false
      }
    },
    "appearance": { "background": "#hex or empty for white", "titleColor": "#hex or empty", "subtitle": "optional short subtitle" }
  },
  "text": { "text": "text box content; '# ' heading lines and '- ' bullets allowed", "style": { "size": "sm|md|lg|xl|hero", "bold": false, "align": "left|center|right", "color": "#hex or empty", "background": "#hex or transparent" } }
}
Include "tile" only for action "tile", "text" only for action "text". Use "clarify" (with a question in "message") only if the request is truly ambiguous; otherwise make a sensible choice and say so in "message".

Chart guidance:
- line/area/stackedArea for time; column for up to ~15 categories; bar for long labels or many categories; stacked/100% when splitting a total by a second field (use seriesBy); combo = first value as columns + other values as lines on a second axis; waterfall for step-by-step changes; pie/doughnut only for parts of a whole with at most 6 rows (sums/counts, never averages); treemap for many parts of a whole; funnel for ordered stages; scatter/bubble to relate numeric measures (category = numeric x column); histogram = distribution of one numeric column over raw rows (values = that column, category null); heatmap = two grouping columns (category + seriesBy) and one value; radar for comparing a few series across 3-12 categories; kpi = one headline number (a single-row result, or a time series for latest value + trend); gauge = value vs. a target (values = [value, target]); table for detail rows.
- category, values, seriesBy, size must be column names exactly as they come out of your SELECT (use the aliases).
- Colors: convert color words to hex. "Brand"/"our green"/"lime" = #9fe870, forest/dark green = #163300, black = #0e0f0c. A dark tile background needs a light title (#ffffff).
- To change an existing tile, set targetTileId to its id and return the complete updated tile (keep what the user didn't ask to change, including its SQL).
- For a text box (a title, a note, key takeaways) use action "text". You don't know the data values, so never put numbers you haven't been given in a text box.

${SQL_RULES}`;
}

// ---- Groq call (session-authenticated, same boundary as synth-sql) ----

async function callAssistant(messages, { json = false, temperature = 0.2 } = {}) {
  const { data: { session } } = sb ? await sb.auth.getSession() : { data: { session: null } };
  if (!session) throw new Error('Please sign in to use the AI assistant.');

  let response;
  try {
    response = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ model: AI_MODEL, messages, temperature, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
    });
  } catch {
    throw new Error(`Can't reach ${CHAT_ENDPOINT}. If you're running locally, use \`vercel dev\` so the API routes are served.`);
  }

  if (response.status === 429) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error?.message || "You've used today's AI messages. Try again later.");
  }
  if (response.status === 401) throw new Error('Your session expired. Sign in again to keep using the AI assistant.');
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message || `The assistant returned an error (${response.status}).`);
  }
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data?.choices?.[0]?.message?.content || '';
}

function recentHistory() {
  return chatHistory.slice(-HISTORY_TURNS * 2).map(m => ({ role: m.role, content: m.content }));
}

function parseJsonReply(text) {
  const match = String(text).match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The assistant's reply wasn't in the expected format. Try rephrasing.");
  return JSON.parse(match[0]);
}

function extractSqlBlocks(text) {
  const out = [];
  String(text).replace(/```sql\s*\n?([\s\S]*?)```/gi, (m, code) => { out.push(code.trim()); return m; });
  return out;
}

function runLocally(sql, maxRows = 200) {
  try {
    return { result: window.synthBridge.runQuery(sql, { maxRows }) };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

// ---- Build-mode validation ----

const HEX_RE = /^#[0-9a-f]{6}$/i;

function cleanHex(v) {
  return typeof v === 'string' && HEX_RE.test(v.trim()) ? v.trim().toLowerCase() : '';
}

function sanitizeStyle(style) {
  if (!style || typeof style !== 'object') return undefined;
  const out = {};
  if (AI_PALETTES.includes(style.palette) && style.palette !== 'synth') out.palette = style.palette;
  if (Array.isArray(style.colors)) {
    const colors = style.colors.slice(0, 12).map(cleanHex);
    if (colors.some(Boolean)) out.colors = colors.map(c => c || null);
  }
  if (['on', 'off'].includes(style.dataLabels)) out.dataLabels = style.dataLabels;
  if (style.legend === false) out.legend = false;
  if (style.gridlines === false) out.gridlines = false;
  if (style.smooth === true) out.smooth = true;
  if (style.varyColors === true) out.varyColors = true;
  if (['compact', 'currency', 'percent', 'integer', 'decimal'].includes(style.format)) out.format = style.format;
  return Object.keys(out).length ? out : undefined;
}

function sanitizeTileDraft(tile) {
  const chart = tile.chart || {};
  const str = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
  const appearance = {};
  if (tile.appearance && typeof tile.appearance === 'object') {
    const bg = cleanHex(tile.appearance.background);
    if (bg && bg !== '#ffffff') appearance.background = bg;
    const tc = cleanHex(tile.appearance.titleColor);
    if (tc) appearance.titleColor = tc;
    if (str(tile.appearance.subtitle)) appearance.subtitle = str(tile.appearance.subtitle);
  }
  const target = tile.targetTileId && dashboardTiles.some(t => t.id === tile.targetTileId && t.kind !== 'text') ? tile.targetTileId : null;
  return {
    targetTileId: target,
    sql: String(tile.sql || '').trim(),
    chartSpec: {
      type: AI_CHART_TYPES.includes(chart.type) ? chart.type : undefined,
      title: str(chart.title) || '',
      category: str(chart.category),
      values: Array.isArray(chart.values) ? chart.values.map(str).filter(Boolean) : [],
      seriesBy: str(chart.seriesBy),
      size: str(chart.size),
      xAxisTitle: str(chart.xAxisTitle) || '',
      yAxisTitle: str(chart.yAxisTitle) || '',
      style: sanitizeStyle(chart.style),
    },
    appearance: Object.keys(appearance).length ? appearance : undefined,
    source: { mode: 'sql' },
  };
}

function sanitizeTextDraft(text) {
  const st = (text && text.style) || {};
  return {
    kind: 'text',
    text: String((text && text.text) || '').slice(0, 2000),
    style: {
      size: ['sm', 'md', 'lg', 'xl', 'hero'].includes(st.size) ? st.size : 'lg',
      bold: st.bold === true,
      align: ['left', 'center', 'right'].includes(st.align) ? st.align : 'left',
      color: cleanHex(st.color),
      background: st.background === 'transparent' ? 'transparent' : (cleanHex(st.background) || 'transparent'),
    },
  };
}

async function runBuild(message) {
  const messages = [{ role: 'system', content: buildSystemPrompt() }, ...recentHistory(), { role: 'user', content: message }];
  let raw = await callAssistant(messages, { json: true, temperature: 0.2 });
  let reply = parseJsonReply(raw);

  if (reply.action === 'tile' && reply.tile) {
    let draft = sanitizeTileDraft(reply.tile);
    let check = draft.sql ? runLocally(draft.sql, 50) : { error: 'No query was returned.' };
    if (check.error) {
      // One repair round: the error text (e.g. "no such column: Revnue")
      // never contains row values, so it's safe to send back.
      messages.push({ role: 'assistant', content: raw });
      messages.push({ role: 'user', content: `That SQL failed in the app with this error: ${check.error}\nFix it and reply with the complete JSON object again.` });
      raw = await callAssistant(messages, { json: true, temperature: 0.1 });
      reply = parseJsonReply(raw);
      if (reply.action === 'tile' && reply.tile) {
        draft = sanitizeTileDraft(reply.tile);
        check = draft.sql ? runLocally(draft.sql, 50) : { error: 'No query was returned.' };
      }
    }
    return {
      mode: 'build',
      kind: 'tile',
      text: String(reply.message || 'Here’s a draft — fine-tune it in the preview, then add it.'),
      draft: { ...draft, note: String(reply.message || '') },
      error: check.error || null,
      raw,
    };
  }
  if (reply.action === 'text' && reply.text) {
    return { mode: 'build', kind: 'text', text: String(reply.message || 'Here’s a text box.'), textBox: sanitizeTextDraft(reply.text), raw };
  }
  return { mode: 'build', kind: 'clarify', text: String(reply.message || 'Could you say a bit more about what you want to see?'), raw };
}

async function runAsk(message) {
  const messages = [{ role: 'system', content: askSystemPrompt() }, ...recentHistory(), { role: 'user', content: message }];
  const text = await callAssistant(messages, { temperature: 0.3 });
  const queries = extractSqlBlocks(text).slice(0, 3).map(sql => ({ sql, ...runLocally(sql) }));
  return { mode: 'ask', text, queries };
}

// Entry point used by bridge.sendAiMessage(). History keeps the text of
// each turn (Build replies as their JSON) so follow-ups resolve.
async function sendAskMessage(message, context = {}) {
  if (!currentUser) throw new Error('Please sign in to use the AI assistant.');
  if (!dataLoaded || !tables.length) throw new Error('Upload a file first.');
  const mode = context.mode === 'build' ? 'build' : 'ask';
  const reply = mode === 'build' ? await runBuild(message) : await runAsk(message);
  chatHistory.push({ role: 'user', content: message, mode });
  chatHistory.push({ role: 'assistant', content: mode === 'build' ? reply.raw : reply.text, mode });
  if (chatHistory.length > 60) chatHistory = chatHistory.slice(-60);
  return reply;
}
