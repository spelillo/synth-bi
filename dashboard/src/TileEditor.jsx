// dashboard/src/TileEditor.jsx — per-tile query + chart-type editor, opened
// from "+ Add tile" or by clicking an existing tile. This is the manual
// tile-building path (Lite Mode's only path; also available in Normal Mode
// alongside AI-built tiles), replacing synth-sql's single persistent query
// box now that the workspace holds several queries at once.
//
// Two modes, toggled at the top (same visual pattern as the Ask/Agent and
// SQL/General toggles elsewhere in the app) — decided over raw SQL alone:
//
//   - Visual: table picker, group-by column, measure column + aggregate
//     (SUM/AVG/COUNT/MIN/MAX), optional filter, chart-type picker. Builds a
//     SQL string under the hood and shows it read-only underneath — never a
//     black box, even in Visual mode.
//   - SQL: the direct port of synth-sql's query editor (line numbers, syntax
//     highlighting textarea) — write the query by hand.
//
// Switching Visual -> SQL pre-fills the SQL box with the generated query,
// editable from there. Switching back SQL -> Visual after hand-editing warns
// that it'll regenerate the query from the visual fields (one-way, same
// "can't always round-trip a hand-written query into a builder" tradeoff
// most BI tools make).
//
// Both modes converge on the same tile shape: { sql, chartSpec }. Runs via
// bridge.js's runQuery(), previews live through Tile.jsx before "Add to
// dashboard" commits it.
//
// STUB

export default function TileEditor(_props) {
  return null;
}
