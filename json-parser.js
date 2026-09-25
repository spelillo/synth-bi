// json-parser.js — ported directly from synth-sql, no changes planned.
// Handles a JSON array of objects or NDJSON, flattening nested objects into
// dot-notation columns (arrays stored as queryable JSON text), matching the
// { headers, rows } shape csv-parser.js/xlsx-parser.js also produce. See
// initial-build.md §2.
//
// Column shape decision (documented here since it's the one real design
// choice in this parser): a nested plain object flattens into dot-notation
// columns ("address.city"), matching how you'd already write a query
// against it. An array value stores as its JSON text in a single column
// instead — turning it into N more columns would explode the schema for
// no benefit — queryable with SQLite's own json_extract()/json_each().

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function flattenJSONRecord(record, prefix, out) {
  for (const key of Object.keys(record)) {
    const value = record[key];
    const flatKey = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      flattenJSONRecord(value, flatKey, out);
    } else if (Array.isArray(value)) {
      out[flatKey] = JSON.stringify(value);
    } else {
      out[flatKey] = (value === null || value === undefined) ? '' : String(value);
    }
  }
  return out;
}

// Tries a single JSON document first (array of objects, or one bare
// object treated as a single-row table); falls back to NDJSON — one
// JSON object per line — if that fails, since a real NDJSON file is a
// SyntaxError as a whole document (concatenated JSON values aren't
// valid JSON on their own).
function parseJSONRecords(text) {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (isPlainObject(parsed)) return [parsed];
    throw new Error('not array/object');
  } catch {
    const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) throw new Error('Empty JSON file');
    const records = [];
    for (let i = 0; i < lines.length; i++) {
      let record;
      try {
        record = JSON.parse(lines[i]);
      } catch {
        throw new Error(`This doesn't look like valid JSON or newline-delimited JSON (line ${i + 1} isn't valid JSON either).`);
      }
      if (!isPlainObject(record)) {
        throw new Error(`Line ${i + 1} isn't a JSON object — newline-delimited JSON needs one object per line.`);
      }
      records.push(record);
    }
    return records;
  }
}

async function parseJSONText(text) {
  const records = parseJSONRecords(text);
  if (records.length === 0) throw new Error('Empty JSON file');

  // Pass 1: flatten every record. Kept as its own array (rather than
  // re-flattening below) since flattening is the expensive part.
  const flatRecords = [];
  for (let start = 0; start < records.length; start += CSV_CHUNK_SIZE) {
    const end = Math.min(start + CSV_CHUNK_SIZE, records.length);
    for (let i = start; i < end; i++) {
      if (!isPlainObject(records[i])) {
        throw new Error(`Record ${i + 1} isn't a JSON object — every element must be an object to become a row.`);
      }
      flatRecords.push(flattenJSONRecord(records[i], '', {}));
    }
    advanceLoadProgress(end - start);
    if (end < records.length) await yieldToUI();
  }

  // Pass 2: union of every key across every record, in first-seen
  // order — JSON records aren't guaranteed uniform shape the way a CSV
  // header row is, so the column list has to be discovered, not assumed.
  const headerKeys = [];
  const seenKeys = new Set();
  for (let start = 0; start < flatRecords.length; start += CSV_CHUNK_SIZE) {
    const end = Math.min(start + CSV_CHUNK_SIZE, flatRecords.length);
    for (let i = start; i < end; i++) {
      for (const key of Object.keys(flatRecords[i])) {
        if (!seenKeys.has(key)) { seenKeys.add(key); headerKeys.push(key); }
      }
    }
    advanceLoadProgress(end - start);
    if (end < flatRecords.length) await yieldToUI();
  }
  const headers = headerKeys.map(k => sanitizeColumnName(k));

  // Pass 3: build rows in header order, filling any key a given record
  // didn't have with '' (same convention loadFileAsTable's ragged-row
  // handling already uses).
  const rows = [];
  for (let start = 0; start < flatRecords.length; start += CSV_CHUNK_SIZE) {
    const end = Math.min(start + CSV_CHUNK_SIZE, flatRecords.length);
    for (let i = start; i < end; i++) {
      const flat = flatRecords[i];
      rows.push(headerKeys.map(k => flat[k] ?? ''));
    }
    advanceLoadProgress(end - start);
    if (end < flatRecords.length) await yieldToUI();
  }

  return { headers, rows: await normalizeThousandsSeparators(rows) };
}

function isJSONFile(fileName) {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  return ext === 'json' || ext === 'ndjson' || ext === 'jsonl';
}
