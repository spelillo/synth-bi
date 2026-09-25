# Synth-BI — Initial Build Doc

Status: **discussion draft** — this document accumulates decisions as we talk. Anything marked `OPEN QUESTION` isn't decided yet.

Repo: [github.com/spelillo/synth-bi](https://github.com/spelillo/synth-bi) · Deploy: `synth-bi.vercel.app` (Vercel, connected to `main`)
Design system: [DESIGN-wise.md](./DESIGN-wise.md) (Wise-inspired — lime green CTA, sage canvas, heavy display type)
Prior art: [synth-sql.com](https://www.synth-sql.com/) ([github.com/spelillo/synth](https://github.com/spelillo/synth))

---

## 1. What synth-bi is

From the repo README: synth-bi is the next iteration of the synth data-tools line, building on synth-sql. Same core promise — upload a file, no cloud DB setup, query it with AI or SQL, everything client-side — but shifted from "get a query result" to **"build a visualization / small dashboard, then export it to Power BI or Tableau."**

Key differences from synth-sql, per the README and this conversation:
- Inputs: CSV + JSON (same as synth-sql) **plus Excel (.xlsx)**.
- The center of gravity moves from a query result table to a **visual preview** — charts are the product, not an add-on to query results.
- The AI interaction is more conversational/iterative within a session — building out a dashboard turn by turn, not just one chart per query.
- Export target changes: synth-sql exports to Excel (data + linked native chart). Synth-bi needs to get data/visuals into **Power BI or Tableau**, "depending on how they set up that session."

---

## 2. What carries over from synth-sql (reuse, don't rebuild)

Synth-sql is plain HTML/CSS/JS, no bundler, split into files that share globals via `state.js`. This has a lot of directly reusable engineering:

| Synth-sql piece | Reuse in synth-bi |
|---|---|
| `sql.js` (SQLite compiled to WASM) as the query engine | Same substrate — every uploaded file becomes a table in one client-side DB, exactly like today. Excel sheets become tables the same way CSV/JSON files do. |
| `csv-parser.js`, `json-parser.js` | Reused as-is. Need a new `xlsx-parser.js` (via SheetJS/`xlsx`) that reads one or more sheets into the same row/column shape the others already produce. |
| `state.js` shared-globals pattern | Same pattern, extended with dashboard state (see §5). |
| `auth.js` (Supabase auth + account modal) | Reused close to as-is. Same Supabase project or a new one — `OPEN QUESTION`. |
| `checkout.js` (tier gating: `canUseFeature`/`requireFeature`, Stripe embedded checkout) | Same gating pattern, new feature keys and tier lines for synth-bi (see §7). |
| `grid.js` (virtualized results grid) | Reused for the underlying data/table view. |
| `charts.js` — SVG chart rendering engine, AI chart-spec refinement, Excel export via Pyodide+XlsxWriter | This is the biggest asset to carry over. The SVG renderer (column/bar/line/area/pie/doughnut/scatter, theming, editable titles-on-canvas) becomes the rendering core for every tile on the synth-bi dashboard, not just one result's chart panel. |
| `chat.js` system-prompt pattern (schema-only context, SQL Mode vs General Mode, Groq via `/api/chat`) | Same shape, extended for dashboard-building conversation (see §6). |
| `api/chat.js` + `api/_aiRateLimit.js` (Vercel function proxying Groq, per-account burst + daily limits, requires signed-in session) | Reused as-is, pointed at a synth-bi Supabase project. |
| Home page layout (`home-grid`: saved workspaces left, drop zone center, "how it works" + save-account card right, footer) | Same layout skeleton, re-skinned in the Wise design system. You called this out explicitly — keep the layout. |
| App view layout (slim header → tab bar → two-pane workspace: editor/results left, AI assistant right) | Same skeleton. The "results" left pane becomes the dashboard canvas; the right pane stays the AI assistant, now dashboard-aware. |
| Multi-table workspace + relationship detection (ERD tab, foreign-key hints in the AI system prompt) | Reused — a dashboard drawing from 3-4 related tables is a very likely use case. |

## 3. What's genuinely new

- **Excel ingestion** (`xlsx-parser.js`), including multi-sheet workbooks (each sheet → one table, same as multi-file CSV upload today).
- **A dashboard canvas**, not a single chart panel — multiple tiles, each backed by its own query + chart spec, arranged on a grid, persisted as part of the workspace.
- **Export to Power BI / Tableau** — a materially different problem than "Excel with a linked chart" (see §8).
- Visual identity: full switch to the Wise design system (`DESIGN-wise.md`) — lime green (`#9fe870`) primary, sage canvas (`#e8ebe6`), near-black ink, `Wise Sans`/Inter at weight 900/600, 24px pill-rounded cards everywhere. This replaces synth-sql's current warm-cream/orange visual style entirely for this product — no shared visual identity between the two sites.

---

## 4. Tech stack — **decided: hybrid shell + component island**

Keep the synth-sql-style shell — home page, header, auth modals, tab bar — as plain vanilla JS/HTML/CSS, same split-file/`state.js`-globals pattern, no bundler, deploys exactly like synth-sql does today. The new dashboard canvas (tiles, drag/resize, per-tile query+chart state) is built as an isolated component mounted inside that shell, using a real framework for the part that's actually more stateful than synth-sql ever needed to be.

**Framework: React**, for the island specifically — `react-grid-layout` (or similar) for tile drag/resize/reflow, and the ecosystem depth pays off once the destination-preview re-skinning (§8a) and Agent Mode tool-calling (§6) are both layered on top of the same tile state.

## 5. Data model & file ingestion

Confirmed: same SQLite-in-browser model as synth-sql. Every uploaded CSV/JSON/Excel file becomes one or more tables in a shared client-side `sql.js` database. Multi-table workspaces, relationship detection, and the table-chip bar all carry over unchanged in spirit.

New state needed for the dashboard layer (extends `state.js`):
- `dashboardTiles`: `[{ id, sql, chartSpec, position: {x, y, w, h} }]` — one entry per tile, each independently re-runnable.
- Something to persist a whole dashboard (not just one saved query) to Supabase for signed-in users, the same way workspaces/chat sessions are saved today.

Proposed defaults (flag either if you want something different):
- **Excel formulas**: read computed values only, no client-side re-evaluation — same as copy/pasting values out of the sheet. Formula re-evaluation is a rabbit hole (Excel's function surface is huge) with little payoff here.
- **Row/table limits**: since §7 removed the paid tier, there's no monetization reason left to split limits by account status. Propose one flat technical cap (e.g. ~500k rows/table) based on what `sql.js`'s WASM SQLite realistically handles smoothly in a browser tab, same for Lite and Normal Mode — a limit about browser performance, not about who's signed in.

## 6. Groq AI logic — **decided: Ask Mode / Agent Mode toggle**

Synth-sql's AI has two modes (SQL / General), sees schema-only context (never row values), and separately does one-shot chart-spec refinement (type/title/axis names) from column metadata + the SQL that produced the result. Both patterns carry over directly.

For the dashboard-building behavior itself, rather than picking one of "suggest" or "act," synth-bi gets **both, as a mode toggle** — same visual pattern as synth-sql's existing SQL/General toggle, now switching between:
- **Ask Mode** — AI tells you how: proposes a query + chart spec in chat, you click "Add to dashboard" to place it as a tile. Same chat-completion pattern as synth-sql today, no new Groq surface.
- **Agent Mode** — AI does it: tool-calling against the dashboard (add/edit/remove/rearrange tiles), narrating what it did as it goes.

**Agent Mode guardrails: act freely, easy undo.** The agent makes changes directly and narrates them after the fact, rather than confirming each one — closer to actually building the dashboard together in real time, matching the README's "back and forth" framing. This puts real weight on the undo/removal UX: every agent-added tile needs to be trivially removable/editable by hand, and the chat narration needs to clearly say what changed (which tile, what query, why) so a bad suggestion is easy to spot and undo rather than something you have to reverse-engineer from the dashboard state. Same boundary as always regardless of mode — schema/metadata only, never row values.

## 7. Pricing & access model — **decided: two free tiers, no paywall**

Correction to this doc's earlier read of synth-sql: `pricing.md` and the README describe an older $9.99 Premium tier, but you've since removed pricing from synth-sql entirely (confirmed in code too — `checkout.js` has `const ALL_TIERS_UNLOCKED = true`, so every tier gate in `canUseFeature`/`requireFeature` currently passes). Synth-sql today is just:
- **Lite Mode** — no sign-in, fully local, no AI.
- **Normal Mode** — free sign-in, unlocks AI usage (and, per the most recent commit, charts).

Synth-bi follows the same shape — two free tiers, no paid unlock, at least for now:
- **Lite Mode** — no sign-in, local only, no AI, no export.
- **Normal Mode** — free sign-in, unlocks the AI assistant (both Ask and Agent mode) and export.

**Lite Mode: manual chart building, no AI.** Upload a file, build dashboard tiles by hand — pick your own query/columns/chart type, full use of the dashboard canvas and destination-preview toggle — with no AI suggestions and no Agent Mode. Mirrors synth-sql's actual Lite Mode shape ("the core tool still works, AI is the thing behind sign-in") rather than a locked-down teaser. Real engineering implication: the manual tile-builder UI (column/type pickers, a query box) needs to exist as a first-class path, not just a fallback state of the AI-assisted one.

**Export: requires a signed-in account.** Same boundary as charts in synth-sql today — Lite Mode gets the full dashboard-building experience, but exporting to Power BI/Tableau needs an account, same gesture as "sign in to unlock this" everywhere else in the app (`requireFeature`-style gate, reusing `checkout.js`'s pattern even with `ALL_TIERS_UNLOCKED` — it's a sign-in gate, not a tier gate).

## 8. Export logic (Power BI / Tableau) — **decided: scope B (data + connector file)**

This is the least like anything synth-sql already does, so worth spelling out the real constraints before deciding scope:

- **Power BI** has no client-generatable "one-click dashboard" file — a `.pbit` template is a zip of a proprietary data-model schema, not practical to build from the browser. What *is* practical, and mirrors what synth-sql's Excel export already does: emit a clean `.xlsx` with a real **Excel Table** (named range, typed columns) per dataset. Power BI's "Get Data → Excel workbook" flow is built around exactly that — it's a one-click import once the file lands, not a double-click-to-open dashboard.
- **Tableau** *can* take a `.csv`/`.xlsx` directly via "Connect to Data," but a nicer landing is a **`.tds`** (Tableau Data Source) file — it's just XML pointing at a data file and declaring field names/types/aliases, no proprietary binary format, genuinely buildable client-side. Double-clicking a `.tds` opens Tableau already connected and typed, better than "load Get Data → Excel workbook then rename columns yourself."
- Neither tool can be handed an actual rendered *chart* the way Excel can (Excel accepts a native embedded chart object, which is what synth-sql already generates). Power BI/Tableau charts are always rebuilt inside those tools against the data — so "export" here really means **exporting well-typed, well-named data that a Power BI or Tableau visual can be dropped onto in a couple of clicks**, not exporting a finished chart.

Two scope options:
- **A. Data-only export** — polished `.xlsx`/`.csv` per dataset (or per dashboard, one sheet per table), clean typed columns, sensible names — reusing the existing Pyodide/XlsxWriter pipeline almost as-is. User rebuilds the visual in Power BI/Tableau themselves.
- **B. Data + connector file** — A, plus a generated `.tds` for Tableau (and possibly documenting the Excel-Table-for-Power-BI convention explicitly in the UI) so the import is closer to one click.

### 8a. Destination preview — **decided: build it, paired with scope B**

Your idea: let the user preview the dashboard, styled to approximate Power BI or Tableau's own look, before they commit to exporting anything. Recommendation: yes, build this, and it settles the scope question above in favor of **B (data + connector file)** — the whole point of a destination preview is setting an accurate expectation for the file you're about to hand them, and a `.tds` for Tableau is what makes that expectation *true* on open (vs. Power BI, where "Get Data → Excel workbook" against a proper Excel Table is the realistic ceiling — there's no client-buildable Power BI template to preview toward).

How it fits the architecture already decided above: this is a **re-skin, not a new engine**. The dashboard canvas (§4's component island) already owns tile layout and renders each tile through the existing SVG chart renderer from `charts.js`. A "Preview as" toggle in the dashboard header (Synth / Power BI / Tableau) swaps a theme — palette, fonts, panel chrome, tile-header style — applied to the exact same tiles and data, the same way `chartTheme()` already swaps light/dark today. No duplicate rendering logic, no second source of truth for what's on the dashboard.

Set expectations plainly in the UI: this is a **structural/layout preview** (how many tiles, roughly what chart types, roughly where), not a pixel-identical clone of either tool — actual fonts, exact chart chrome, and corporate templates will differ once it's really open in Power BI or Tableau. Worth saying so directly next to the toggle, so it reads as a helpful approximation rather than a promise.

**Decision:** scope B, paired with a destination-preview toggle on the dashboard canvas.

## 9. Layout & pages (carried from synth-sql, re-skinned)

| Route | Synth-sql equivalent | Synth-bi |
|---|---|---|
| `/` | `synth.html` — home (workspaces + drop zone) → app view | Same structure. Drop zone copy changes to CSV/JSON/**Excel**. "How it works" 3 steps become: Upload → Ask/Query → **Build your dashboard**. |
| App view tabs | Query & Chat / Table View / Relationships | **Decided: Dashboard** / Table View / Relationships. "Query & Chat" folds into the Dashboard tab rather than staying separate — same two-pane shape (canvas left, AI assistant right with the Ask/Agent toggle), but there's no single persistent query box anymore. Instead, "+ Add tile" opens a small per-tile editor (query + chart-type picker, reusing the existing SQL editor/highlighting component) scoped to that one tile — since the product is now several queries/visuals at once, not one query → one result. |
| `/welcome`, `/guides`, `/terms`, `/privacy` | Static marketing pages sharing `marketing.css` | Same pattern, new copy, Wise design system instead of `marketing.css`'s current styling. |

---

## 10. V1 scope & roadmap — recommendation

The full vision in this doc is a lot for a first release: two AI modes, a drag/resize dashboard canvas, three file formats, an ERD tab, a Tableau connector file, and a two-tool visual re-skin. Shipping all of it at once means nothing gets real usage until everything is done. Recommendation: **cut by sequencing, not by dropping** — everything decided above stays the plan, v1 just proves the core loop before layering on the two most speculative/highest-effort pieces.

**v1 — the core loop (upload → build → export):**
- Ingestion: CSV, JSON, **and Excel** (the headline new format — cutting it would make v1 indistinguishable from synth-sql).
- `sql.js` multi-table workspace, table-chip bar, relationship detection + ERD tab — near-free reuse from synth-sql, no reason to hold these back.
- Dashboard canvas (React island): add/remove/resize/rearrange tiles, each backed by its own query + the existing `charts.js` SVG renderer.
- Manual tile builder (query box + column/chart-type picker) — available in Lite and Normal Mode alike, and doubles as the "advanced" path for AI-built tiles too.
- **Ask Mode only.** AI proposes a query + chart spec in chat, "Add to dashboard" places it as a tile — reuses `chat.js`'s existing one-shot pattern almost untouched, no new Groq tool-calling surface to build and harden yet.
- Export (signed-in only, per your call above): clean `.xlsx`/`.csv` per table, Excel Table–formatted for Power BI's Get Data flow, plus a Tableau `.tds` connector file.
- Lite vs Normal Mode, Wise design system, auth/account modal — all as already decided.

**v1.1 — fast follow, once the core loop has real usage:**
- **Agent Mode.** The harder half of §6 (tool-calling loop against Groq, act-freely-with-undo UX) is real net-new engineering, not a port — worth building against a dashboard canvas that's already proven with real users in Ask Mode, rather than debugging both at once.
- **Destination preview** (§8a). Purely a re-skin of tiles that already exist by v1.1, so it slots in cleanly, and by then you'll have a better sense of what actually reads as "looks like Power BI" vs "looks like Tableau" from watching how people actually build dashboards.

**v1.2+ — once the shape of real usage is clear:** saved/shareable dashboard links, richer Excel handling (formulas, multiple sheets per source with smarter joins), more chart types, anything that comes out of watching what v1 users actually try to build.

Flag anything you'd rather pull forward or push back — this is a sequencing bet, not a hard line.

---

## 11. Decision log

**Round 1:** tech stack (hybrid shell + island, §4), AI interaction (Ask/Agent toggle, §6), access model (two free tiers, no paywall, §7), export scope (data + connector file, paired with a destination preview, §8/§8a).

**Round 2:** framework for the island is React (§4), Lite Mode is manual chart building with no AI (§7), Agent Mode acts freely with easy undo (§6).

**Round 3:** export requires a signed-in account even though it's not an AI feature (§7), Query & Chat folds into the Dashboard tab rather than staying separate (§9), v1 scope sequences Agent Mode and the destination preview after a core-loop v1 (§10).

**Round 4:** Excel/row-limit defaults confirmed — computed values only, flat ~500k row cap regardless of sign-in (§5). All open questions in this doc are now resolved; see [BUILD-INSTRUCTIONS.md](./BUILD-INSTRUCTIONS.md) for the folder scaffold, user flow, and UI/UX spec built from this doc + [DESIGN-wise.md](./DESIGN-wise.md).
