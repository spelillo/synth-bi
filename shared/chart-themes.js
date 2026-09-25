// shared/chart-themes.js — the three chart themes chart-engine.js can
// render against, keyed to state.js's `previewMode` ('synth' | 'powerbi' |
// 'tableau'). Each theme supplies { surface, text, text2, grid, axis, series }
// — the same shape synth-sql's chartTheme() already returns for light/dark,
// extended with two new entries instead of just two modes of one theme.
//
// 'synth' reads its palette from tokens.css's --chart-series-* custom
// properties (see tokens.css). 'powerbi' and 'tableau' are new palettes to
// design — approximate each tool's actual default report-canvas look
// (fonts, panel chrome, series colors) closely enough to read as "this is
// roughly what it'll look like there," per initial-build.md §8a's stated
// bar (structural/layout preview, not a pixel-identical clone).
//
// STUB — design the powerbi/tableau palettes once §8a's visual design pass happens.
