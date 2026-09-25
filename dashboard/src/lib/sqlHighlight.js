// dashboard/src/lib/sqlHighlight.js — ported from synth-sql's chat.js
// highlightSQL(): a lightweight SQL syntax highlighter, no library, one regex
// pass tokenizing strings/identifiers/comments/keywords/numbers in priority
// order (strings and quoted identifiers match before the keyword
// alternative, so a keyword-looking word inside a string is never
// re-highlighted). Escapes HTML first, then tokenizes the escaped text,
// since none of the token patterns depend on & < > that escaping changes.
// Used by the tile editor's SQL box, Visual mode's read-only SQL preview,
// and SQL blocks in AI replies.

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'ON',
  'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'IS',
  'IN', 'LIKE', 'GLOB', 'BETWEEN', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'DROP', 'ALTER', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'UNION', 'ALL', 'EXISTS', 'DESC', 'ASC', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
  'DEFAULT', 'CAST', 'WITH', 'OVER', 'PARTITION', 'IF', 'USING', 'INDEX', 'VIEW', 'TRIGGER',
  'REAL', 'INTEGER', 'TEXT',
];

const SQL_TOKEN_RE = new RegExp(
  `('(?:[^']|'')*')` +                        // 1: string literal
  `|("(?:[^"]|"")*")` +                        // 2: quoted identifier
  `|(--[^\\n]*)` +                              // 3: line comment
  `|\\b(${SQL_KEYWORDS.join('|')})\\b` +       // 4: keyword
  `|\\b(\\d+\\.?\\d*)\\b`,                     // 5: number
  'gi'
);

export function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlightSQL(code) {
  return escapeHtml(code).replace(SQL_TOKEN_RE, (match, str, ident, comment, kw, num) => {
    if (str !== undefined) return `<span class="sql-tok-string">${match}</span>`;
    if (ident !== undefined) return `<span class="sql-tok-ident">${match}</span>`;
    if (comment !== undefined) return `<span class="sql-tok-comment">${match}</span>`;
    if (kw !== undefined) return `<span class="sql-tok-keyword">${match}</span>`;
    if (num !== undefined) return `<span class="sql-tok-number">${match}</span>`;
    return match;
  });
}
