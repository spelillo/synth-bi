// dashboard/src/SqlEditor.jsx — the query box ported from synth-sql's
// #query-input (chat.js: updateLineNumbers / updateQueryHighlight /
// autoGrowQueryInput): a plain <textarea> whose own text is transparent,
// layered exactly over a <pre> painting the same text through
// highlightSQL(), so the editor gets live keyword/string/number coloring
// without giving up native textarea editing, selection, and undo. Line
// numbers in a gutter, grows to fit up to a max height, ⌘/Ctrl+Enter runs.

import { useLayoutEffect, useRef } from 'react';
import { highlightSQL } from './lib/sqlHighlight.js';

export default function SqlEditor({ value, onChange, onRun, readOnly = false, minHeight = 140, maxHeight = 360, ariaLabel = 'SQL query' }) {
  const textRef = useRef(null);
  const preRef = useRef(null);
  const gutterRef = useRef(null);
  const lineCount = Math.max(1, value.split('\n').length);

  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)}px`;
  }, [value, minHeight, maxHeight]);

  const syncScroll = () => {
    const el = textRef.current;
    if (preRef.current) { preRef.current.scrollTop = el.scrollTop; preRef.current.scrollLeft = el.scrollLeft; }
    if (gutterRef.current) gutterRef.current.scrollTop = el.scrollTop;
  };

  const onKeyDown = e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (onRun) onRun();
      return;
    }
    if (e.key === 'Tab' && !e.shiftKey && !readOnly) {
      // Two spaces instead of leaving the editor; Shift+Tab still moves focus.
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: end } = el;
      const next = value.slice(0, s) + '  ' + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
    }
  };

  let html = highlightSQL(value);
  if (value.endsWith('\n')) html += '\n';

  return (
    <div className={`sql-editor${readOnly ? ' is-readonly' : ''}`}>
      <div className="sql-editor-gutter" ref={gutterRef} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <div className="sql-editor-stack">
        <pre className="sql-editor-highlight" ref={preRef} aria-hidden="true"><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
        <textarea
          ref={textRef}
          className="sql-editor-input"
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={ariaLabel}
          placeholder={readOnly ? '' : 'SELECT category, SUM(amount) AS total\nFROM your_table\nGROUP BY category'}
          onChange={e => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
