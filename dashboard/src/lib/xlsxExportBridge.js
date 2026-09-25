// dashboard/src/lib/xlsxExportBridge.js — thin wrapper the island calls to
// trigger the shell's Excel export (bridge.js's exportToExcel()), since the
// Pyodide/XlsxWriter engine lives in the shell (excel_chart.py), not here.
// Keeps the island from needing its own copy of that fairly heavy pipeline.
//
// STUB
export function exportSelectedTilesToExcel(_tileIds) {}
