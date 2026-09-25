// shared/chart-themes.js — the three chart themes chart-engine.js can
// render against, keyed to state.js's `previewMode` ('synth' | 'powerbi' |
// 'tableau'). Each theme supplies { surface, text, text2, grid, axis,
// series, positive, negative, fontFamily } — the same shape synth-sql's
// chartTheme() returned for light/dark, extended with two new entries
// instead of just two modes of one theme.
//
// 'synth' reads its palette from tokens.css's --chart-series-* custom
// properties (green-led — see tokens.css) when a document is available,
// falling back to the same literal values otherwise. A tile's own
// style.palette / style.colors (chart-engine.js applyChartStyle) override
// whichever theme is active. 'powerbi' and 'tableau' are sequenced into
// v1.1 with the destination-preview re-skin (initial-build.md §8a/§10):
// until their design pass happens they resolve to the Synth theme, so the
// previewMode plumbing already works end to end and only these two entries
// (plus dashboard/src/themes/*.css) need filling in.

const SYNTH_FALLBACK = {
  surface: '#ffffff',
  text: '#0e0f0c',   // --color-ink
  text2: '#454745',  // --color-body
  grid: '#eef0ec',
  axis: '#c9cec5',
  positive: '#054d28',
  negative: '#d03238',
  series: ['#9fe870', '#163300', '#38c8ff', '#ffc091', '#2ead4b', '#6b7a64', '#c5edab', '#054d28'],
  fontFamily: "Inter, system-ui, -apple-system, sans-serif",
};

function readCssVar(css, name) {
  return css ? (css.getPropertyValue(name) || '').trim() : '';
}

function synthTheme() {
  const css = typeof document !== 'undefined' && typeof getComputedStyle === 'function'
    ? getComputedStyle(document.documentElement)
    : null;
  const series = SYNTH_FALLBACK.series.map((fallback, i) => readCssVar(css, `--chart-series-${i + 1}`) || fallback);
  return {
    ...SYNTH_FALLBACK,
    text: readCssVar(css, '--color-ink') || SYNTH_FALLBACK.text,
    text2: readCssVar(css, '--color-body') || SYNTH_FALLBACK.text2,
    series,
  };
}

const THEMES = {
  synth: synthTheme,
  // v1.1 — design pass pending (initial-build.md §8a).
  powerbi: synthTheme,
  tableau: synthTheme,
};

export const PREVIEW_MODES = ['synth', 'powerbi', 'tableau'];

export function getChartTheme(mode = 'synth') {
  return (THEMES[mode] || THEMES.synth)();
}
