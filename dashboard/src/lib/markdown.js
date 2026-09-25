// dashboard/src/lib/markdown.js — the markdown-lite renderer for assistant
// replies, ported from synth-sql's chat.js (renderInlineFormatting /
// renderProse / formatMessage). Model output is escaped first, then bold,
// inline code, and bullet/numbered lists are layered on top of the
// now-safe text. ```sql blocks are pulled out before any of that and
// rendered separately by the caller (AiPanel), which runs them locally.

import { escapeHtml, highlightSQL } from './sqlHighlight.js';

function inline(line) {
  return line
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>');
}

function prose(escaped) {
  const parts = [];
  let list = null;
  const flush = () => {
    if (!list) return;
    const start = list.type === 'ol' && list.start > 1 ? ` start="${list.start}"` : '';
    parts.push(`<${list.type} class="chat-list"${start}>${list.items.map(i => `<li>${i}</li>`).join('')}</${list.type}>`);
    list = null;
  };
  escaped.split('\n').forEach(line => {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = !bullet && line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      if (!list || list.type !== type) { flush(); list = { type, items: [], start: numbered ? Number(numbered[1]) : 1 }; }
      list.items.push(inline(bullet ? bullet[1] : numbered[2]));
    } else {
      flush();
      const heading = line.match(/^#{1,4}\s+(.*)$/);
      if (heading) parts.push(`<p class="chat-heading">${inline(heading[1])}</p>`);
      else if (line.trim()) parts.push(`<p>${inline(line)}</p>`);
    }
  });
  flush();
  return parts.join('');
}

// Splits a reply into [{ type: 'html', html } | { type: 'sql', sql, index }]
// so SQL blocks can be rendered as interactive components.
export function splitReply(text) {
  const segments = [];
  let index = 0;
  const re = /```(\w*)\s*\n?([\s\S]*?)```/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) segments.push({ type: 'html', html: prose(escapeHtml(text.slice(last, m.index))) });
    const lang = (m[1] || '').toLowerCase();
    if (lang === 'sql') segments.push({ type: 'sql', sql: m[2].trim(), index: index++ });
    else segments.push({ type: 'html', html: `<pre class="chat-code"><code>${escapeHtml(m[2].trim())}</code></pre>` });
    last = re.lastIndex;
  }
  if (last < text.length) segments.push({ type: 'html', html: prose(escapeHtml(text.slice(last))) });
  return segments;
}

export { highlightSQL };
