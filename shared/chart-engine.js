// shared/chart-engine.js — the framework-agnostic core of synth-sql's
// charts.js: analyzeChartColumns(), heuristicChartSpec(), buildChartData(),
// and the SVG renderers (renderChartSVG / renderCartesianSVG / renderPieSVG).
// These are pure functions (spec + data + theme -> SVG string) with no DOM
// dependency beyond string building, so this one module is importable both
// ways:
//
//   - the vanilla shell, via a plain <script type="module"> tag (used by the
//     Table View tab's any lightweight previews, if needed)
//   - the dashboard/ React island's Vite build, via a normal ES import,
//     wrapped in a thin <Tile> component that sets the returned SVG string
//     as its content
//
// One engine, one set of chart-rendering bugs to fix, both consumers share
// it. AI chart-spec refinement (requestAiChartSpec/aiRawToSpec) stays out of
// here — that's chat.js/bridge.js's job, this module only turns a spec into
// pixels.
//
// STUB — port the pure functions from synth-sql/charts.js verbatim to start;
// theme is now driven by shared/chart-themes.js instead of chartTheme()'s
// light/dark-only CSS variable lookup, so it can also serve the Power
// BI/Tableau preview skins (initial-build.md §8a).
