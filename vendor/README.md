# vendor/

Vendored third-party files loaded at runtime without a package manager, same
role as synth-sql's `vendor/`.

- `xlsxwriter-3.2.9-py3-none-any.whl` — copied from `synth-sql/vendor/`, loaded by `excel_chart.py` under Pyodide. Keeps the Excel export from depending on PyPI availability at runtime.
- `xlsx.full.min.js` — SheetJS Community Edition 0.20.3, from SheetJS's own CDN (`https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`). Loaded lazily by `xlsx-parser.js` on the first Excel upload. Vendored rather than installed from npm because the npm-registry `xlsx` package is frozen at 0.18.5, which has known security advisories. To upgrade, replace this file with a newer build from cdn.sheetjs.com.
