# excel_chart.py — adapted from synth-sql's excel_chart.py, run under Pyodide
# (loaded client-side, first export click only — see synth-sql's charts.js
# loadExcelEngine() pattern, which this ports).
#
# Difference from synth-sql: synth-sql builds one two-sheet workbook (data +
# one linked native chart) per query result. Synth-bi exports a *dashboard*,
# so this needs to emit one Excel Table per tile's underlying table/query —
# one sheet per table, each formatted as a real Excel Table (named range,
# typed columns) so Power BI's "Get Data -> Excel workbook" flow picks it up
# cleanly (initial-build.md §8). Native linked charts are optional/secondary
# here, since the point of this export is Power BI import, not viewing the
# chart in Excel itself.
#
# STUB — port build_xlsx() from synth-sql/excel_chart.py, adjust for
# multi-table-per-workbook output.
