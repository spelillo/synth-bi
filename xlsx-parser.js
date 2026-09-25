// xlsx-parser.js — new for synth-bi. Reads an uploaded .xlsx workbook via
// SheetJS and produces the same { headers, rows } shape csv-parser.js/
// json-parser.js already produce, so app.js's upload flow treats all three
// formats identically.
//
// SheetJS is vendored (vendor/xlsx.full.min.js, 0.20.3 from SheetJS's own
// CDN — the npm-registry `xlsx` package is frozen at 0.18.5, which has known
// CVEs) and loaded lazily on the first Excel upload, so CSV/JSON-only
// sessions never pay for its ~950KB.
//
// One table per sheet, matching the existing "each uploaded file is a
// table" behavior for multi-file CSV/JSON uploads. Multi-sheet workbooks add
// every non-empty sheet at once, same gesture as dropping several CSVs
// together.
//
// Values only, no formula re-evaluation (initial-build.md §5's confirmed
// default) — a formula cell's cached result (cell.v) is what's read, same as
// copy/pasting values out of the sheet. Dates are converted from Excel's
// serial numbers straight to ISO text ("2024-01-15", or with a time part if
// it isn't midnight) via SSF.parse_date_code, which is timezone-free —
// going through JS Date objects would shift dates by the browser's UTC
// offset. ISO text also sorts and groups correctly in SQLite (strftime).
//
// Row cap: MAX_ROWS_PER_TABLE (state.js), same flat ~500k limit as every
// other source format — enforced by app.js after parsing, like CSV/JSON.

const SHEETJS_SRC = '/vendor/xlsx.full.min.js';
let sheetJsPromise = null;

function loadSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!sheetJsPromise) {
    sheetJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SHEETJS_SRC;
      s.onload = () => resolve(window.XLSX);
      s.onerror = () => { sheetJsPromise = null; reject(new Error("Couldn't load the Excel reader. Check your connection and try again.")); };
      document.head.appendChild(s);
    });
  }
  return sheetJsPromise;
}

function isXLSXFile(fileName) {
  return /\.(xlsx|xlsm)$/i.test(fileName);
}

const pad2 = n => String(n).padStart(2, '0');

function xlsxCellToText(XLSX, cell) {
  if (!cell) return '';
  switch (cell.t) {
    case 'n': {
      if (cell.z && XLSX.SSF.is_date(cell.z)) {
        const d = XLSX.SSF.parse_date_code(cell.v);
        if (d) {
          const date = `${d.y}-${pad2(d.m)}-${pad2(d.d)}`;
          const hasTime = d.H || d.M || Math.round(d.S);
          return hasTime ? `${date} ${pad2(d.H)}:${pad2(d.M)}:${pad2(Math.round(d.S))}` : date;
        }
      }
      // Excel stores 0.1 + 0.2-style float noise (e.g. 12.300000000000001);
      // 15 significant digits is Excel's own display precision.
      return Number.isInteger(cell.v) ? String(cell.v) : String(+cell.v.toPrecision(15));
    }
    case 'b': return cell.v ? 'TRUE' : 'FALSE';
    case 'e': return ''; // #N/A, #DIV/0! etc. read as empty, like a blank cell
    case 'd': return cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : String(cell.v);
    case 'z': return '';
    default: return cell.v === null || cell.v === undefined ? '' : String(cell.v);
  }
}

// Turns one worksheet into { headers, rows }, or null if it has no data.
// The first non-empty row is the header row (same as CSV). Fully-empty
// columns with no header — common trailing junk in hand-edited sheets — are
// dropped; a blank header on a column that does hold data becomes
// column_N so it's still queryable.
function sheetToTable(XLSX, ws) {
  if (!ws || !ws['!ref']) return null;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const grid = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    let any = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const text = xlsxCellToText(XLSX, ws[XLSX.utils.encode_cell({ r, c })]).trim();
      if (text) any = true;
      row.push(text);
    }
    if (any) grid.push(row);
  }
  if (grid.length === 0) return null;

  const headerRow = grid[0];
  const body = grid.slice(1);
  const keep = headerRow.map((h, c) => !!h || body.some(row => row[c]));
  const headers = [];
  headerRow.forEach((h, c) => { if (keep[c]) headers.push(h ? sanitizeColumnName(h) : `column_${c + 1}`); });
  const rows = body.map(row => row.filter((_, c) => keep[c]));
  if (!headers.length) return null;
  return { headers, rows };
}

// Returns [{ sheetName, headers, rows }] — one entry per non-empty sheet.
async function parseXLSX(file) {
  const XLSX = await loadSheetJS();
  const data = await file.arrayBuffer();
  let wb;
  try {
    wb = XLSX.read(data, { type: 'array', cellNF: true, cellDates: false, cellFormula: false, cellHTML: false, cellText: false });
  } catch (err) {
    throw new Error(`Couldn't read this Excel file (${err.message}). If it's password-protected or an older .xls, save it as .xlsx and try again.`);
  }

  const sheets = [];
  for (const sheetName of wb.SheetNames) {
    const table = sheetToTable(XLSX, wb.Sheets[sheetName]);
    if (!table) continue;
    advanceLoadProgress(table.rows.length);
    await yieldToUI();
    sheets.push({ sheetName, headers: table.headers, rows: await normalizeThousandsSeparators(table.rows) });
  }
  if (!sheets.length) throw new Error('This workbook has no data in any sheet.');
  return sheets;
}

// Table name for one sheet: a single-sheet workbook is named after the
// file (same as a CSV); a multi-sheet workbook names each table after its
// sheet, falling back to "<file>_sheet1" for Excel's generic default names.
function xlsxTableName(fileName, sheetName, sheetCount) {
  const fileBase = slugifyTableName(fileName);
  if (sheetCount === 1) return fileBase;
  const sheetBase = slugifyTableName(sheetName + '.x');
  return /^sheet_?\d*$/.test(sheetBase) ? `${fileBase}_${sheetBase}` : sheetBase;
}
