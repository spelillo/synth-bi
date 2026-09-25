# vendor/

Vendored third-party files loaded at runtime without a package manager, same
role as synth-sql's `vendor/`.

- `xlsxwriter-*.whl` — copy from `synth-sql/vendor/`, loaded by `excel_chart.py` under Pyodide. Keeps the Excel export from depending on PyPI availability at runtime.
