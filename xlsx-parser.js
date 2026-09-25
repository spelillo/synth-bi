// xlsx-parser.js — new for synth-bi. Reads an uploaded .xlsx workbook via
// SheetJS (the `xlsx` package — vendor or CDN, TBD) and produces the same
// { columns, rows } shape csv-parser.js/json-parser.js already produce, so
// app.js's upload flow treats all three formats identically.
//
// One table per sheet, matching the existing "each uploaded file is a
// table" behavior for multi-file CSV/JSON uploads. Multi-sheet workbooks add
// every sheet at once, same gesture as dropping several CSVs together.
//
// Values only, no formula re-evaluation (initial-build.md §5's confirmed
// default) — SheetJS's read() with cellText/cellDates options gives computed
// values directly, same as copy/pasting out of the sheet.
//
// Row cap: MAX_ROWS_PER_TABLE (state.js), same flat ~500k limit as every
// other source format — no tier split, since it's a browser-performance
// limit, not a monetization one.

// STUB
async function parseXLSX(_file) {
  // TODO: load SheetJS, read every sheet, map each to { name, columns, rows }.
}
