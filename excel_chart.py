# excel_chart.py — adapted from synth-sql's excel_chart.py, run under Pyodide
# (loaded client-side on the first export click only — see app.js
# loadExcelEngine(), ported from synth-sql's charts.js). Nothing is uploaded:
# the tables are handed to this module in-process and the finished .zip is
# handed back to the browser as bytes.
#
# Difference from synth-sql: synth-sql built one two-sheet workbook (data +
# one linked native chart) per query result. Synth-bi exports a *dashboard*
# for Power BI / Tableau (initial-build.md §8, scope B), so this emits one
# workbook per table, each a single sheet formatted as a real Excel Table
# (named range, typed columns) — Power BI's "Get Data -> Excel workbook" flow
# lists Excel Tables directly, and the Tableau .tds files
# (dashboard/src/lib/tdsExport.js) point at these same workbooks. Numbers are
# written as numbers and ISO dates as real Excel dates, so both tools type
# the columns correctly on import instead of treating everything as text.
# Native charts aren't emitted: Power BI and Tableau rebuild visuals against
# the data, and the export's dashboard image shows the layout.
#
# Entry point: build_export_zip(payload_json) -> bytes (a .zip).

import base64
import datetime
import io
import json
import re
import zipfile

import xlsxwriter

INK = "#0E0F0C"


def _unique_headers(columns):
    # Excel Table headers must be unique and non-empty (ported from synth-sql).
    used = set()
    headers = []
    for raw in columns:
        base = str(raw).strip()[:250] or "Column"
        name, k = base, 2
        while name.lower() in used:
            name, k = f"{base} ({k})", k + 1
        used.add(name.lower())
        headers.append(name)
    return headers


def _sheet_name(name):
    return re.sub(r"[:\\/?*\[\]]", "_", str(name))[:31] or "Sheet1"


def _table_name(name):
    # Excel Table names: letters, digits, underscores, periods; must start
    # with a letter or underscore and must not look like a cell reference.
    clean = re.sub(r"[^A-Za-z0-9_.]", "_", str(name)) or "Data"
    if not re.match(r"[A-Za-z_]", clean[0]) or re.match(r"^[A-Za-z]{1,3}\d+$", clean) or re.match(r"^[Rr]\d*[Cc]\d*$", clean):
        clean = "tbl_" + clean
    return clean[:255]


_ISO = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?")


def _parse_iso(value):
    m = _ISO.match(value)
    if not m:
        return None
    y, mo, d, h, mi, s = (int(g) if g else 0 for g in m.groups())
    try:
        return datetime.datetime(y, mo, d, h, mi, s)
    except ValueError:
        return None


def _parse_number(value):
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n == n and n not in (float("inf"), float("-inf")) else None


def build_table_xlsx(table):
    columns = table["columns"]
    rows = table["rows"]
    n = len(rows)
    ncols = len(columns)

    buf = io.BytesIO()
    # strings_to_formulas off: a cell whose text starts with "=" is written
    # as text, never executed as a formula when the file is opened.
    wb = xlsxwriter.Workbook(buf, {
        "in_memory": True,
        "strings_to_numbers": False,
        "strings_to_formulas": False,
        "strings_to_urls": False,
    })
    wb.set_properties({"title": table["name"], "comments": "Created with Synth-BI"})
    ws = wb.add_worksheet(_sheet_name(table["name"]))

    int_fmt = wb.add_format({"num_format": "#,##0"})
    dec_fmt = wb.add_format({"num_format": "#,##0.00"})
    date_fmt = wb.add_format({"num_format": "yyyy-mm-dd"})
    datetime_fmt = wb.add_format({"num_format": "yyyy-mm-dd hh:mm"})

    kinds = []
    for c in columns:
        if c.get("kind") == "numeric":
            kinds.append("int" if c.get("integer") else "num")
        elif c.get("kind") == "date" and c.get("isoDate"):
            kinds.append("date" if c.get("dateOnly") else "datetime")
        else:
            kinds.append("text")

    for r, row in enumerate(rows, start=1):
        for c in range(ncols):
            v = row[c] if c < len(row) else None
            if v is None or v == "":
                continue
            kind = kinds[c]
            if kind in ("int", "num"):
                num = _parse_number(v)
                if num is not None:
                    ws.write_number(r, c, num, int_fmt if kind == "int" else dec_fmt)
                    continue
            elif kind in ("date", "datetime"):
                dt = _parse_iso(str(v))
                if dt is not None:
                    ws.write_datetime(r, c, dt, date_fmt if kind == "date" else datetime_fmt)
                    continue
            ws.write_string(r, c, str(v))

    headers = _unique_headers([c["name"] for c in columns])
    ws.add_table(0, 0, max(n, 1), max(ncols - 1, 0), {
        "name": _table_name(table["name"]),
        "style": "Table Style Medium 7",
        "columns": [{"header": h} for h in headers],
    })
    for c in range(ncols):
        longest = len(headers[c]) + 3
        for row in rows[:1000]:
            v = row[c] if c < len(row) else None
            if v is not None:
                longest = max(longest, len(str(v)))
        ws.set_column(c, c, min(max(longest + 2, 8), 50))
    ws.freeze_panes(1, 0)
    wb.close()
    return buf.getvalue()


def build_export_zip(payload_json):
    p = json.loads(payload_json)
    folder = p.get("folder") or "synth-bi-export"
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for table in p.get("tables", []):
            z.writestr(f"{folder}/{table['name']}.xlsx", build_table_xlsx(table))
        for f in p.get("files", []):
            z.writestr(f"{folder}/{f['path']}", f["text"])
        for f in p.get("binaries", []):
            z.writestr(f"{folder}/{f['path']}", base64.b64decode(f["base64"]))
    return out.getvalue()
