// dashboard/src/lib/tdsExport.js — builds Tableau .tds (Tableau Data Source)
// files: plain XML declaring a connection to the exported data file plus
// field names/types/roles, no proprietary binary format. Genuinely
// buildable client-side — no server round-trip needed. Pairs with the
// shell's export (bridge.exportDashboard), which writes the matching .xlsx
// for each table; each .tds points at its .xlsx by bare filename, so the two
// travel together (Tableau looks next to the .tds when the original path
// doesn't exist on the opening machine).
//
// Field-type mapping (initial-build.md §8): the load-time column profile
// (app.js profileColumns) decides the type — numeric -> integer/real
// measure (id-like numbers stay dimensions), ISO dates -> date/datetime
// (the Excel export writes them as real Excel dates), everything else ->
// string dimension. Captions are the same prettified names the charts use.
//
// One .tds per table: a single-connection, single-table data source is the
// shape every Tableau version opens reliably. Multi-table relationship
// models are a v1.x candidate once confirmed relationships are worth
// encoding.

import { prettifyColumnName } from '../../../shared/chart-engine.js';

const esc = s => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/'/g, '&apos;')
  .replace(/"/g, '&quot;');

// Excel sheet names: max 31 chars, none of : \ / ? * [ ]
export function excelSheetName(name) {
  return String(name).replace(/[:\\/?*[\]]/g, '_').slice(0, 31) || 'Sheet1';
}

const ID_LIKE = /(^|_)id$|^id_|uuid|zip|postal|phone/i;

function fieldType(col) {
  if (col.kind === 'numeric') return { datatype: col.integer ? 'integer' : 'real', role: ID_LIKE.test(col.name) ? 'dimension' : 'measure', type: ID_LIKE.test(col.name) ? 'ordinal' : 'quantitative' };
  if (col.kind === 'date' && col.isoDate) return { datatype: col.dateOnly ? 'date' : 'datetime', role: 'dimension', type: 'ordinal' };
  return { datatype: 'string', role: 'dimension', type: 'nominal' };
}

function colLetter(n) {
  let s = '';
  for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// table: { name, rowCount, columns: [{ name, kind, integer, isoDate, dateOnly }] }
export function buildTds(table, { fileName = `${table.name}.xlsx` } = {}) {
  const sheet = excelSheetName(table.name);
  const conn = `excel-direct.${table.name.replace(/[^A-Za-z0-9_]/g, '_')}`;
  const lastCell = `${colLetter(table.columns.length - 1)}${table.rowCount + 1}`;
  const relationCols = table.columns.map((c, i) => `        <column datatype='${fieldType(c).datatype}' name='${esc(c.name)}' ordinal='${i}' />`).join('\n');
  const fields = table.columns.map(c => {
    const t = fieldType(c);
    return `  <column caption='${esc(prettifyColumnName(c.name))}' datatype='${t.datatype}' name='[${esc(c.name)}]' role='${t.role}' type='${t.type}' />`;
  }).join('\n');
  return `<?xml version='1.0' encoding='utf-8' ?>
<!-- Created with Synth-BI. Keep this file in the same folder as ${esc(fileName)}, then double-click it to open Tableau connected to the data. -->
<datasource formatted-name='${esc(table.name)}' inline='true' source-platform='win' version='18.1' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <connection class='federated'>
    <named-connections>
      <named-connection caption='${esc(fileName)}' name='${conn}'>
        <connection class='excel-direct' cleaning='no' compat='no' dataRefreshTime='' filename='${esc(fileName)}' interpretationMode='0' password='' server='' validate='no' />
      </named-connection>
    </named-connections>
    <relation connection='${conn}' name='${esc(sheet)}' table='[${esc(sheet)}$]' type='table'>
      <columns gridOrigin='A1:${lastCell}:no:A1:${lastCell}:0' header='yes' outcome='6'>
${relationCols}
      </columns>
    </relation>
  </connection>
  <aliases enabled='yes' />
${fields}
</datasource>
`;
}

export function buildAllTds(tables) {
  return tables.map(t => ({ fileName: `${t.name}.tds`, content: buildTds(t) }));
}
