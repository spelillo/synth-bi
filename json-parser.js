// json-parser.js — ported directly from synth-sql, no changes planned.
// Handles a JSON array of objects or NDJSON, flattening nested objects into
// dot-notation columns (arrays stored as queryable JSON text), matching the
// { columns, rows } shape csv-parser.js/xlsx-parser.js also produce. See
// initial-build.md §2.
