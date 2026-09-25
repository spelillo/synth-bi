// app.js — ported from synth-sql's app.js: home view, file upload
// (CSV/JSON/Excel — xlsx-parser.js is the one new input path), workspace
// switching, and everything not owned by a more specific file. Drives
// home-view <-> app-view, same as synth-sql.
//
// The Dashboard tab's canvas itself is NOT here — that's the React island in
// /dashboard, mounted at #dashboard-root. app.js's job for that tab is only
// to keep window.synthBridge (bridge.js) in sync with `tables`/`db` as files
// load, so the island always sees current schema.
//
// STUB — see BUILD-INSTRUCTIONS.md for the home-view and app-view flows.
