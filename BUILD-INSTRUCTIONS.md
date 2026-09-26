# Synth-BI — Build Instructions

This is the implementation-facing doc: folder structure, architecture, user flow, and UI/UX, all derived from the decisions already made in [initial-build.md](./initial-build.md) and the tokens/components defined in [DESIGN-wise.md](./DESIGN-wise.md). Read those two first if something here seems unexplained — this doc doesn't re-argue those decisions, it builds on top of them.

Scope: this covers **v1** (initial-build.md §10) — the core loop of upload → build a dashboard → export. Agent Mode and the Power BI/Tableau destination-preview re-skin are real parts of the design (documented below so the v1 architecture doesn't paint them into a corner) but are sequenced into v1.1, not built first.

---

## 1. Architecture

**Hybrid shell + component island** (initial-build.md §4). Two codebases living in one repo:

```
Vanilla shell (no bundler, deploys as static files + Vercel functions — exactly like synth-sql)
  index.html, welcome.html, guides.html, terms.html, privacy.html
  state.js, bridge.js, auth.js, checkout.js, grid.js, chat.js, app.js
  csv-parser.js, json-parser.js, xlsx-parser.js
  api/ (Vercel serverless functions)
  excel_chart.py + vendor/ (Pyodide/XlsxWriter, runs client-side)
        │
        │  window.synthBridge  (bridge.js — the ONLY contact surface)
        ▼
React island (Vite build, output committed to nothing — built at deploy time)
  dashboard/  →  builds to  →  /dashboard-dist/dashboard.js + dashboard.css
  loaded by index.html via a plain <script type="module"> tag
```

**The shell owns data. The island owns the dashboard UI.** Concretely:

- The shell (`state.js`) owns `db` (sql.js), `tables`, `currentUser`, and — critically — `dashboardTiles` itself. The array of tiles is shell state, not island state.
- The island (`dashboard/`) is a rendering and interaction layer on top of that array. It reads tiles, renders them, lets the user drag/resize/add/edit them, and writes changes back — all through `window.synthBridge` (`bridge.js`), never by reaching into `state.js`'s globals or `db` directly.
- This is why `dashboardTiles` living in `state.js` rather than inside a React `useState` matters: it's what lets Table View, the AI assistant, and Supabase persistence all agree on one dashboard without the island needing to be the source of truth for state the rest of the app also needs.

**Why this split, concretely:** it lets `charts.js`'s rendering logic (`shared/chart-engine.js`), `chat.js`'s Groq pattern, `auth.js`, and `checkout.js` all port from synth-sql with minimal changes, while the genuinely new, genuinely more-stateful surface — a multi-tile drag/resize canvas — gets a framework built for exactly that, without a full rewrite (initial-build.md §4's reasoning).

**Build/deploy:** `npm run build` (root `package.json`) runs `dashboard/`'s own `npm install && vite build`, emitting `dashboard-dist/`. `vercel.json` sets this as the project's `buildCommand`. Locally, `vercel dev` doesn't run Vite for you — run `npm run build` once (or `npm run dev` inside `dashboard/` for hot-reloading the island alone against a mocked bridge) before `vercel dev` picks up the shell.

---

## 2. Folder structure reference

```
synth-bi/
  index.html              Home view + app view shell (mirrors synth-sql's synth.html)
  welcome.html            About / Lite vs Normal Mode comparison
  guides.html             How-to guide index
  terms.html, privacy.html
  tokens.css              Wise design system as CSS custom properties — single source of truth
  marketing.css           Static-page styling, reads tokens.css

  state.js                Every shared global: db, tables, currentUser, dashboardTiles, aiMode, previewMode
  bridge.js                window.synthBridge — the shell<->island contract
  csv-parser.js, json-parser.js, xlsx-parser.js   File ingestion, all producing { columns, rows }
  auth.js                 Supabase auth + account modal
  checkout.js             Sign-in gating only (no paid tier) — canUseFeature/requireFeature
  grid.js                 Virtualized results grid (Table View tab)
  chat.js                 Groq chat pattern, Ask/Agent mode
  app.js                  Home view, upload flow, workspace switching

  api/
    chat.js                Groq proxy (signed-in only, rate-limited)
    _aiRateLimit.js
    _supabaseAuth.js

  excel_chart.py           Pyodide/XlsxWriter export engine (client-side)
  vendor/                  Vendored xlsxwriter wheel

  supabase/
    schema.sql
    migrations/

  shared/
    chart-engine.js         Framework-agnostic SVG chart renderer (ported from synth-sql's charts.js)
    chart-themes.js          Synth / Power BI / Tableau theme definitions

  dashboard/                React island — separate package.json, own build step
    package.json
    vite.config.js
    src/
      main.jsx               Mounts into #dashboard-root
      bridge.js               Re-exports window.synthBridge for clean imports
      Dashboard.jsx            The canvas: tile grid, "+ Add tile", preview-mode toggle, AiPanel
      Tile.jsx                 One tile: renders via shared/chart-engine.js
      TileEditor.jsx            Per-tile query + chart-type editor (manual build path)
      AiPanel.jsx               Ask/Agent mode chat panel
      themes/
        synth.css, powerbi.css, tableau.css   Cosmetic re-skins (§8a)
      lib/
        tdsExport.js            Builds the Tableau .tds connector file
        xlsxExportBridge.js      Triggers the shell's Excel export

  DESIGN-wise.md            Design system source
  initial-build.md          Product decisions (read first)
  BUILD-INSTRUCTIONS.md     This file
```

---

## 3. Design system application

DESIGN-wise.md is written for a money-transfer brand; §"Examples (illustrative)" in that file already establishes the pattern of re-purposing its components for other product shapes (e.g. `ex-product-selector` "re-purposed for SaaS/B2B, NOT a literal product gallery"). Synth-bi does the same. Concrete mapping:

| DESIGN-wise.md component | Synth-bi use |
|---|---|
| `hero-band` (sage canvas, `{typography.display-mega}`) | Home view's drop-zone headline — "Turn any file into a dashboard," Wise Sans/Manrope 900 at hero scale. |
| `card-content` (white, `{rounded.xl}`, on sage canvas) | Every dashboard tile. `{colors.canvas}` surface on `{colors.canvas-soft}` canvas is exactly the elevation cue DESIGN-wise.md already defines (§Elevation) — no shadows needed, the two-tone surface contrast does the work. |
| `card-feature-green` (`{colors.primary-pale}` fill) | The AI panel's own proposed-tile preview before it's added — a soft-green "this is what I'd add" state, visually distinct from a committed tile (`card-content`). |
| `badge-positive` / `badge-negative` | Row-count/status pills on tiles (e.g. "single table," relationship-detected flags), AI rate-limit or error notices in the chat panel. |
| `button-primary` (`{colors.primary}` lime pill) | The one and only primary CTA per screen — "Choose a file," "Add to dashboard," "Export." DESIGN-wise.md is explicit that Wise green is reserved for THE primary action, never decorative — synth-bi follows that literally: at most one lime-green button visible in the dashboard canvas at a time. |
| `button-secondary` / `button-tertiary` | Everything else — "Preview as" toggle options, tab bar, secondary tile actions (edit/remove). |
| `ex-data-table-cell` | Table View tab's grid header/body styling. |
| `ex-auth-form-card` | Account modal, ported near-verbatim from synth-sql's structure, re-themed. |
| `ex-empty-state-card` | Empty dashboard state ("+ Add your first tile," or the AI panel before any messages). |

**What does NOT carry over:** `currency-converter-card` and anything currency/money-specific in DESIGN-wise.md's illustrative examples — no analog in synth-bi, skip entirely. Chart series colors are the one place DESIGN-wise.md has no opinion (it's a brand-identity system, not a data-viz palette) — `tokens.css`'s `--chart-series-*` values are inherited from synth-sql's validated colorblind-safe palette as a placeholder; worth a deliberate pass to confirm they still read well against sage/lime rather than synth-sql's warm-cream system, but not a blocker for v1.

**One deliberate deviation from DESIGN-wise.md's "Don't":** the spec says never pair the green CTA with a green background. Synth-bi's dashboard canvas sits on `{colors.canvas-soft}` (sage, not green) with white tiles — this is the spec's own hero-band pattern, not a violation. Just confirming the reading, since "green dashboard on green canvas" could sound like the forbidden pairing at a glance — it isn't; sage and lime are different tokens for exactly this reason.

---

## 4. User flow

### 4.1 First visit, Lite Mode (no account)

1. **Land on `/`.** Home view: left column "Your dashboards" (empty state — no account, nothing saved), center drop zone ("Turn any CSV, JSON, or Excel file into a dashboard"), right column "How it works" (Upload → Build tiles by hand or ask AI → Export to Power BI or Tableau) plus a save-account card pitching sign-in.
2. **Upload a file.** Drag-and-drop or click to browse. CSV/JSON behave exactly as synth-sql today; an `.xlsx` workbook adds one table per sheet (multi-sheet workbooks load all sheets at once, same gesture as dropping several CSVs together).
3. **Home view swaps to app view.** Header (workspace name, file info, help), tab bar: **Dashboard** / Table View / Relationships. Dashboard tab is active by default and empty except a "+ Add tile" affordance (`ex-empty-state-card` styling).
4. **Build a tile manually.** Click "+ Add tile" → `TileEditor` opens with a **Visual / SQL** toggle at the top (§5.3 has the full spec): Visual mode is a table/group-by/measure/aggregate picker for anyone who doesn't want to write SQL, SQL mode is the direct query editor synth-sql already has, and both end at the same chart-type selector. Run it, preview it, "Add to dashboard" places it as a tile on the canvas.
5. **AI panel is visible but disabled**, with a clear "Sign in to use the AI assistant" state (same pattern as synth-sql's chat panel today) — Lite Mode is genuinely usable without it, per initial-build.md §7, just manual.
6. **Try to export.** Clicking "Export" opens the export flow (§4.3) up through the destination-preview step, but the actual "Download" action requires sign-in — same `requireSignIn()` gesture as everything else gated in the app. This is where Lite Mode meets its one hard wall.

### 4.2 Signing in → Normal Mode

7. Account modal opens (ported from synth-sql's `auth.js`/account-modal structure), pitch copy updated for synth-bi specifically:
   - **Save your dashboards** — pick up any workspace on another device.
   - **AI dashboard assistant** — ask it to build tiles, or let it build the dashboard with you directly.
   - **Export to Power BI or Tableau** — download your data, ready to import.
8. On sign-in, the file/tiles already in the browser session carry over (same as synth-sql's Lite→Normal continuity) — nothing uploaded before sign-in is lost, and the export the user was just trying to run becomes available immediately.

### 4.3 Normal Mode — AI-assisted dashboard building

9. **AI panel activates.** Mode toggle at the top: **Ask** (default) / **Agent** — visually identical pattern to synth-sql's SQL/General toggle. Ask Mode is what ships in v1; Agent Mode's flow is specified here for continuity but isn't built until v1.1 (initial-build.md §10).
   - **Ask Mode:** user asks in plain English ("show revenue by month"); AI replies with a proposed query + chart spec, rendered inline in chat as a small preview card (`card-feature-green` styling — visually distinct from a committed tile) with an **"Add to dashboard"** button.
   - **Agent Mode (v1.1):** user asks the same way; the AI runs the query, adds the tile directly, and narrates what it did ("Added a line chart of revenue by month, top-left"). No confirmation step (initial-build.md §6's "act freely, easy undo" decision) — every agent-added tile carries the same remove/edit affordances as a manually-built one, so a bad suggestion is a one-click fix, not a conversation.
10. **Iterate.** Multiple tiles accumulate on the canvas; drag/resize to arrange. The AI's schema context always includes a compact summary of current tiles (initial-build.md's chat.js note), so "make the last one a bar chart instead" resolves correctly.

### 4.4 Destination preview & export

11. **"Preview as" toggle** in the dashboard header: Synth (default) / Power BI / Tableau. Switching re-skins every tile in place (palette, fonts, tile chrome) via `shared/chart-themes.js` + `dashboard/src/themes/*.css` — same data, same layout, different visual language. A small persistent note under the toggle sets expectations: *"An approximation of layout and chart types — fonts and exact styling will differ once it's open in [tool]."*
12. **Export.** Button opens a selection step (which tiles/tables to include — default: all), then generates:
    - One `.xlsx` per table, each sheet formatted as a real Excel Table (named range, typed columns) — Power BI's "Get Data → Excel workbook" flow is built around exactly this.
    - A `.tds` (Tableau Data Source XML) — double-clicking it opens Tableau already connected and typed.
    - Both bundled in one download, with a short line of guidance under each: "For Power BI: Get Data → Excel workbook, then pick this file." / "For Tableau: double-click the .tds file."
13. **Requires sign-in** (confirmed decision, initial-build.md §7 Round 3) — if reached from Lite Mode, this is where `requireSignIn()` fires.

### 4.5 Returning signed-in user

14. Home view's "Your dashboards" column is now populated (mirrors synth-sql's saved-workspaces list) — reopening one restores `tables`, `dashboardTiles`, and chat history exactly as left.

---

## 5. UI/UX by screen

### 5.1 Home view (`#home-view`)

Same `home-grid` three-column skeleton as synth-sql (initial-build.md §2), re-themed:

- **Left — "Your dashboards."** Card list (`card-content`), each card showing a tiny static thumbnail of the dashboard's tile layout (a cheap win: reuse `shared/chart-engine.js` to render a miniature, non-interactive version of the saved tiles) plus name/last-edited. Empty state for Lite Mode: a quiet prompt to sign in, not a hard sell.
- **Center — drop zone.** `hero-band`-styled: `{colors.canvas-soft}` background, headline in the display-mega scale ("Turn any file into a dashboard"), sub-copy naming all three formats (CSV, JSON, Excel — the Excel mention matters, it's the new capability), `button-primary` "Choose a file."
- **Right — "How it works" + save card.** Three steps (Upload → Build, by hand or with AI → Export to Power BI or Tableau), plus the account-pitch card (`card-feature-green`) from §4.2.

### 5.2 App view header

Ported structure from synth-sql: workspace switcher, "+ Add table" (opens the same upload flow, adds another table to the workspace — now also accepting `.xlsx`), file/table info, "Save to cloud" (Normal Mode only), help button. Wise-styled: `nav-bar` token (`{colors.canvas}` background, `{spacing.md} {spacing.xl}` padding).

### 5.3 Dashboard tab (the core screen)

Two-pane layout, same skeleton as synth-sql's Query & Chat tab (left pane / resizer / right pane), contents replaced:

**Left pane — the canvas (React island, `Dashboard.jsx`):**
- Header row: "Preview as" toggle (Synth/Power BI/Tableau) on the left, "+ Add tile" and "Export" (`button-primary`, the one lime CTA in this view) on the right.
- Tile grid below: `react-grid-layout`-driven, each tile a `card-content` surface at `{rounded.xl}`, drag handle + resize corner on hover, a small overflow menu (edit query, remove, duplicate) per tile.
- Empty state (no tiles yet): centered `ex-empty-state-card`, "+ Add your first tile" and, in Normal Mode, "or just ask the assistant →" pointing at the AI panel.

**Right pane — AI panel (`AiPanel.jsx`):**
- Same header shape as synth-sql's "AI SQL Assistant" bar: title, Ask/Agent toggle (styled identically to the existing SQL/General toggle component — same interaction pattern, new labels), Clear Session.
- Chat transcript below. An Ask Mode reply that includes a proposed tile renders its preview as an inline `card-feature-green` block with "Add to dashboard" — distinct enough from plain prose replies that it reads as an object you can act on, not just an answer.
- Disabled/locked state in Lite Mode: reuse synth-sql's exact "Sign in to use the AI assistant" empty-state pattern.

**TileEditor** (modal or slide-over, opened from "+ Add tile" or clicking an existing tile). **Decided: raw SQL, with a simpler picker as the default entry point** — a top-level **Visual / SQL** toggle, same interaction pattern as the Ask/Agent and SQL/General toggles elsewhere in the app:

- **Visual** (default): table picker (if the workspace has more than one), a "Group by" column dropdown, a "Measure" column + aggregate function (SUM/AVG/COUNT/MIN/MAX), an optional simple filter, and the chart-type picker. Builds the underlying SQL string and shows it read-only just below the fields — transparent, not a black box, so someone can graduate to SQL mode by seeing exactly what their picks produced.
- **SQL**: the query box ported directly from synth-sql (`#query-input`-equivalent: line numbers, live syntax highlighting).

Switching Visual → SQL pre-fills the query box with the generated SQL, editable from there. Switching back after hand-editing warns that it'll regenerate the query from the visual fields (one-way — the same tradeoff most BI tools make between a builder and hand-written SQL). Both modes converge on the same `{ sql, chartSpec }` tile shape and the same chart-type picker (reusing `shared/chart-engine.js`'s `CHART_TYPES`). "Preview" renders live via `Tile.jsx` before "Add to dashboard" commits it.

### 5.4 Table View tab

Direct port of synth-sql's Table View — `grid.js`'s virtualized grid, table-chip bar for multi-table workspaces, no changes beyond re-theming.

### 5.5 Relationships tab

Direct port of synth-sql's ERD tab — ported unchanged (initial-build.md §2), since multi-table dashboards make relationship detection at least as useful here as in synth-sql.

### 5.6 Export flow

Modal, opened from the Dashboard tab's "Export" button:
1. **Select** — checklist of tables/tiles to include, defaulted to all.
2. **Preview** — reuses the destination-preview theme already active (if the user was previewing as Tableau, the export modal shows a Tableau-flavored summary of what's about to download).
3. **Sign-in gate** (Lite Mode only) — inline prompt, not a redirect, so the export selection isn't lost.
4. **Download** — one `.zip` (or sequential downloads, implementation detail) containing the per-table `.xlsx` files and the `.tds`, plus the two-line "how to open this" guidance from §4.4.

### 5.7 Account modal, static pages

Ported structure from synth-sql (`auth.js`, `terms.html`/`privacy.html`/`welcome.html`/`guides.html`), re-themed to Wise tokens, copy updated for synth-bi's actual pitch (§4.2) and the fact that export — not charts — is the feature most worth naming as an account perk.

---

## 6. Build order (v1)

Roughly the order that unblocks the most downstream work fastest:

1. `tokens.css` (done) → confirm it renders correctly against real markup before building on it further.
2. Port `csv-parser.js`, `json-parser.js` from synth-sql verbatim; implement `xlsx-parser.js` (SheetJS).
3. `state.js` + `bridge.js` contract (both scaffolded) — implement `runQuery`/`getSchema`/`getTiles`/`setTiles` for real against `sql.js`.
4. `shared/chart-engine.js` — port synth-sql's `charts.js` pure functions.
5. `dashboard/` — `Dashboard.jsx` + `Tile.jsx` rendering real tiles via the bridge and chart engine; `react-grid-layout` wiring.
6. `TileEditor.jsx` — the manual build path. This alone makes Lite Mode a complete, testable product.
7. `auth.js`, `checkout.js` (sign-in gating only) — port from synth-sql.
8. `chat.js` + `AiPanel.jsx` — Ask Mode only.
9. `excel_chart.py` + export flow (§5.6) + `tdsExport.js` — the other half of the core loop.
10. Static pages, home-view "Your dashboards," Supabase schema/persistence.

---

## 7. Supabase setup

Project already created — **project ref `fvjlqcrjfbxgqjbbqdaa`**, URL `https://fvjlqcrjfbxgqjbbqdaa.supabase.co`. Separate project from synth-sql's, per initial-build.md §2.

**Already wired into the repo:**
- `auth.js` — `SUPABASE_URL` and the publishable key (`sb_publishable_KSbBry-RR0L4QnSUT5k8Kg_kLF3PkjX`) are hardcoded there, same pattern as synth-sql. This key is meant to be public (client-side), safe as-is.
- `.env.local` — `SUPABASE_URL` is set (server-side admin client in `api/_aiRateLimit.js` reads it too).

**Still needed before the AI rate limit / any signed-in persistence works:**
- `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` — a secret, get it from the Supabase dashboard (Project Settings → API → `service_role`), not from anything documented here. Until it's set, `_aiRateLimit.js`'s admin client is `null` and it fails open (AI usage works, just unmetered) — fine for early local dev, not fine to ship.
- Schema + migrations — `supabase/schema.sql` is still a stub. Once the tables/columns are designed (profiles, `ai_usage_events`, and the new dashboard-tiles persistence shape — see the stub's own comment), apply them with the CLI below rather than pasting SQL into the dashboard by hand, so it's versioned.

**CLI link (run once, from this folder):**
```bash
supabase login
supabase init
supabase link --project-ref fvjlqcrjfbxgqjbbqdaa
```
After linking, `supabase db push` applies `supabase/migrations/` to the real project — no need to hand-construct a direct Postgres connection string for normal migration work. (A direct connection string does exist — `postgresql://postgres:[YOUR-PASSWORD]@db.fvjlqcrjfbxgqjbbqdaa.supabase.co:5432/postgres` — for the rare case a raw `psql` connection is actually needed; the password isn't recorded anywhere in this repo and shouldn't be.)

Agent Mode (`chat.js`'s tool-calling loop) and the Power BI/Tableau theme CSS (`dashboard/src/themes/`) come after this list is working end-to-end, per initial-build.md §10.

### 7.1 Shared auth with synth-sql

Signing in on either synth-sql.com or bi.synth-sql.com now signs the user
into both. Auth lives entirely in synth-sql's Supabase project
(`gukxpikthryasymfuhgl`); this project (`fvjlqcrjfbxgqjbbqdaa`) keeps its
own `dashboards`/`dashboard_tables`/`ai_usage_events`/Storage, addressed
with that same user id but no longer the source of it.

Supabase's Third-Party Auth (Authentication → Third-Party Auth) only
trusts external identity providers — Firebase, Clerk, WorkOS, Auth0,
Amazon Cognito — not another Supabase project's own Auth. There's no
supported way to make this project's Postgres validate a JWT signed by
synth-sql's Auth service directly, so RLS can never see who's calling on
its own. Data access is routed through this project's own API instead,
gated on a token verified against synth-sql:

- `storage-cookie.js` (both repos, kept identical) — session storage as a
  cookie scoped to `.synth-sql.com` instead of the client's default
  `localStorage`, which can't cross the subdomain boundary.
- `auth.js` — two clients: `sb` signs in against synth-sql's project using
  the shared cookie storage, and is used for every UI/auth call plus
  `authFetch` (attaches `sb`'s access token as a bearer header). `sbData`
  points at this project but is only ever used for `uploadToSignedUrl` —
  Storage calls that carry their own one-time authorization and don't need
  RLS to understand who's calling.
- `api/_supabaseAuth.js` — verifies a request's bearer token against
  synth-sql's project (that's who issues them now), returning the real
  user id or null. Never trusts a client-supplied id.
- `api/_supabaseAdmin.js` + `api/dashboards/` (`index.js`, `[id].js`,
  `[id]/tables.js`) — the actual data access. Each route verifies the
  caller via `_supabaseAuth.js`, then reads/writes with the service-role
  key, filtering every query on that verified user id explicitly (the
  service role bypasses RLS entirely, so this is what enforces ownership
  instead — same trust pattern `_aiRateLimit.js` already used for
  `ai_usage_events`). Table uploads/downloads go through short-lived
  signed Storage URLs these routes mint, rather than proxying file bytes
  through the function body (a Vercel function's body limit is far below
  the bucket's 50MB per-file allowance).
- `supabase/migrations/20260925210000_drop_auth_users_fk.sql` — drops the
  `references auth.users(id)` foreign keys on `user_id` columns here,
  since this project's own `auth.users` table never gets a row for these
  ids (nobody signs up here anymore). `user_id` stays a plain
  `uuid default auth.uid()`; the RLS policies are left in place as a
  harmless backstop even though the service-role routes above bypass them.

**Still needed:**
- `SUPABASE_SERVICE_ROLE_KEY` must be set in this project's environment
  (Vercel + `.env.local`) — the same variable `_aiRateLimit.js` already
  documents needing.
- `supabase db push` to apply the FK-drop migration above.
