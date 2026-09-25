// dashboard/src/TextTile.jsx — a text box on the dashboard canvas, the
// slide-deck half of the canvas: titles, section headers, notes, and
// commentary placed and resized exactly like chart tiles (they're tiles
// too — { id, kind: 'text', text, style, position } in dashboardTiles).
//
// Double-click (or "Edit text") to type; a small toolbar over the box sets
// size, weight, alignment, and colors. The text itself supports a tiny
// markdown subset — "# " heading lines, "- " bullets, **bold**, *italic* —
// so a single box can hold a heading plus a few bullet points.

import { useEffect, useRef, useState } from 'react';
import { isDarkColor } from './Tile.jsx';

export const TEXT_SIZES = [
  { id: 'sm', label: 'Small', px: 13 },
  { id: 'md', label: 'Body', px: 16 },
  { id: 'lg', label: 'Large', px: 22 },
  { id: 'xl', label: 'Heading', px: 32 },
  { id: 'hero', label: 'Title', px: 52 },
];

export const DEFAULT_TEXT_STYLE = { size: 'lg', bold: false, italic: false, align: 'left', valign: 'top', color: '', background: 'transparent' };

export const SWATCHES = ['transparent', '#ffffff', '#e8ebe6', '#e2f6d5', '#9fe870', '#163300', '#0e0f0c', '#38c8ff', '#ffc091', '#ffd11a'];

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export function renderTextMarkup(text) {
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
  String(text || '').split('\n').forEach(line => {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (bullet) { (list = list || []).push(`<li>${inline(bullet[1])}</li>`); return; }
    flush();
    if (heading) out.push(`<div class="tb-h tb-h${heading[1].length}">${inline(heading[2])}</div>`);
    else if (!line.trim()) out.push('<div class="tb-gap"></div>');
    else out.push(`<div>${inline(line)}</div>`);
  });
  flush();
  return out.join('');
}

export function SwatchPicker({ value, onChange, label, allowTransparent = true }) {
  return (
    <div className="swatch-picker" role="group" aria-label={label}>
      {SWATCHES.filter(c => allowTransparent || c !== 'transparent').map(c => (
        <button
          key={c}
          type="button"
          className={`swatch${(value || 'transparent') === c ? ' is-active' : ''}${c === 'transparent' ? ' is-transparent' : ''}`}
          style={c === 'transparent' ? undefined : { background: c }}
          aria-label={c === 'transparent' ? 'No fill' : c}
          title={c === 'transparent' ? 'No fill' : c}
          onClick={() => onChange(c)}
        />
      ))}
      <label className="swatch swatch-custom" title="Custom color">
        <input type="color" value={value && value.startsWith('#') ? value : '#9fe870'} onChange={e => onChange(e.target.value)} aria-label={`${label}: custom color`} />
        <i className="ph ph-eyedropper" aria-hidden="true" />
      </label>
    </div>
  );
}

export default function TextTile({ tile, onChange, onRemove, onDuplicate, autoEdit = false }) {
  const st = { ...DEFAULT_TEXT_STYLE, ...(tile.style || {}) };
  const [editing, setEditing] = useState(autoEdit);
  const [draft, setDraft] = useState(tile.text || '');
  const [panel, setPanel] = useState(null); // 'color' | 'fill' | null
  const areaRef = useRef(null);

  useEffect(() => { if (!editing) setDraft(tile.text || ''); }, [tile.text, editing]);
  useEffect(() => {
    if (editing && areaRef.current) { areaRef.current.focus(); areaRef.current.select(); }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== tile.text) onChange({ text: draft });
  };
  const setStyle = patch => onChange({ style: { ...st, ...patch } });

  const dark = st.background && st.background !== 'transparent' && isDarkColor(st.background);
  const px = (TEXT_SIZES.find(s => s.id === st.size) || TEXT_SIZES[2]).px;
  const boxStyle = {
    background: st.background === 'transparent' ? 'transparent' : st.background,
    color: st.color || (dark ? '#ffffff' : 'var(--color-ink)'),
    fontSize: `${px}px`,
    fontWeight: st.bold ? 700 : 400,
    fontStyle: st.italic ? 'italic' : 'normal',
    textAlign: st.align,
    justifyContent: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[st.valign],
  };

  return (
    <div className={`text-tile size-${st.size}${st.background === 'transparent' ? ' is-transparent' : ''}${editing ? ' is-editing' : ''}`} style={boxStyle}>
      <div className="text-tile-toolbar" onMouseDown={e => e.stopPropagation()}>
        <span className="tile-drag-handle text-tile-grip" title="Drag to move" aria-hidden="true"><i className="ph ph-dots-six-vertical" /></span>
        <select className="tt-select" aria-label="Text size" value={st.size} onChange={e => setStyle({ size: e.target.value })}>
          {TEXT_SIZES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button type="button" className={`tt-btn${st.bold ? ' is-on' : ''}`} aria-pressed={st.bold} aria-label="Bold" onClick={() => setStyle({ bold: !st.bold })}><i className="ph ph-text-b" aria-hidden="true" /></button>
        <button type="button" className={`tt-btn${st.italic ? ' is-on' : ''}`} aria-pressed={st.italic} aria-label="Italic" onClick={() => setStyle({ italic: !st.italic })}><i className="ph ph-text-italic" aria-hidden="true" /></button>
        {['left', 'center', 'right'].map(a => (
          <button key={a} type="button" className={`tt-btn${st.align === a ? ' is-on' : ''}`} aria-pressed={st.align === a} aria-label={`Align ${a}`} onClick={() => setStyle({ align: a })}>
            <i className={`ph ${a === 'center' ? 'ph-text-align-center' : a === 'right' ? 'ph-text-align-right' : 'ph-text-align-left'}`} aria-hidden="true" />
          </button>
        ))}
        <button type="button" className={`tt-btn${panel === 'color' ? ' is-on' : ''}`} aria-label="Text color" onClick={() => setPanel(p => (p === 'color' ? null : 'color'))}>
          <i className="ph ph-text-aa" aria-hidden="true" /><span className="tt-chip" style={{ background: st.color || (dark ? '#fff' : '#0e0f0c') }} />
        </button>
        <button type="button" className={`tt-btn${panel === 'fill' ? ' is-on' : ''}`} aria-label="Background" onClick={() => setPanel(p => (p === 'fill' ? null : 'fill'))}>
          <i className="ph ph-paint-bucket" aria-hidden="true" />
        </button>
        <span className="tt-spacer" />
        <button type="button" className="tt-btn" aria-label="Edit text" onClick={() => setEditing(true)}><i className="ph ph-pencil-simple" aria-hidden="true" /></button>
        <button type="button" className="tt-btn" aria-label="Duplicate text box" onClick={onDuplicate}><i className="ph ph-copy" aria-hidden="true" /></button>
        <button type="button" className="tt-btn is-danger" aria-label="Remove text box" onClick={onRemove}><i className="ph ph-trash" aria-hidden="true" /></button>
        {panel && (
          <div className="tt-popover">
            <SwatchPicker
              label={panel === 'color' ? 'Text color' : 'Background'}
              value={panel === 'color' ? (st.color || '#0e0f0c') : st.background}
              allowTransparent={panel === 'fill'}
              onChange={c => { setStyle(panel === 'color' ? { color: c } : { background: c }); }}
            />
          </div>
        )}
      </div>

      {editing ? (
        <textarea
          ref={areaRef}
          className="text-tile-input"
          value={draft}
          aria-label="Text box content"
          placeholder={'# Heading\nWrite a note, a takeaway, or a section title.\n- bullets work too'}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onMouseDown={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); setDraft(tile.text || ''); setEditing(false); }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
          }}
        />
      ) : (
        <div
          className="text-tile-content"
          onDoubleClick={() => setEditing(true)}
          dangerouslySetInnerHTML={{ __html: tile.text ? renderTextMarkup(tile.text) : '<div class="tb-placeholder">Double-click to add text</div>' }}
        />
      )}
    </div>
  );
}
