// dashboard/src/lib/tdsExport.js — builds a Tableau .tds (Tableau Data
// Source) file: plain XML declaring a connection to the exported data file
// plus field names/types/aliases, no proprietary binary format. Genuinely
// buildable client-side — no server round-trip needed. Pairs with
// bridge.js's exportToTableau(), which calls this after the shell produces
// the underlying data file via exportToExcel()'s CSV/xlsx path.
//
// STUB — see initial-build.md §8 for the field-type-mapping rationale.
export function buildTds(_tables) {}
