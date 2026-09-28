// dashboard/src/TextTile.jsx — a text box on the dashboard canvas, the
// slide-deck half of the canvas: titles, section headers, notes, and
// commentary placed and resized exactly like chart tiles (they're tiles
// too — { id, kind: 'text', text, style, position } in dashboardTiles).
//
// Double-click (or "Edit text") to type; a small toolbar over the box sets
// font, size, bold/italic/underline/strikethrough, alignment, and colors.
// The toolbar never sits on the text: it floats just above the box when
// there's room in the canvas, and otherwise (a box at the very top) takes
// its own row above the text area while typing. The text itself supports a tiny
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

// Point sizes offered in the toolbar. A box stores the one picked as
// style.fontSize; older boxes (and AI drafts) carry only a named `size`,
// which still resolves through TEXT_SIZES.
export const FONT_SIZES = [10, 12, 13, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 52, 64, 72, 96];

// '' keeps the size's own face (body sans, display face for Heading/Title).
export const FONT_FAMILIES = [
  { id: '', label: 'Default', css: '' },
  { id: 'inter', label: 'Inter', css: "'Inter', system-ui, sans-serif" },
  { id: 'manrope', label: 'Manrope', css: "'Manrope', 'Inter', sans-serif" },
  { id: 'arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { id: 'georgia', label: 'Georgia', css: "Georgia, 'Times New Roman', serif" },
  { id: 'times', label: 'Times', css: "'Times New Roman', Times, serif" },
  { id: 'mono', label: 'Mono', css: "'JetBrains Mono', ui-monospace, Menlo, monospace" },
];

export const DEFAULT_TEXT_STYLE = { size: 'lg', fontSize: null, font: '', bold: false, italic: false, underline: false, strike: false, align: 'left', valign: 'top', color: '', background: 'transparent' };

export function textStylePx(st) {
  const n = Number(st.fontSize);
  if (n > 0) return n;
  return (TEXT_SIZES.find(s => s.id === st.size) || TEXT_SIZES[2]).px;
}

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
  const [above, setAbove] = useState(false);
  const areaRef = useRef(null);
  const frameRef = useRef(null);

  // Float the toolbar above the box when the scroll area has room for it;
  // measured on hover/edit since the room changes as the canvas scrolls.
  const placeToolbar = () => {
    const el = frameRef.current;
    if (!el) return;
    const wrap = el.closest('.dash-grid-wrap');
    const bar = el.querySelector('.text-tile-toolbar');
    const room = el.getBoundingClientRect().top - (wrap ? wrap.getBoundingClientRect().top : 0);
    setAbove(room >= (bar ? bar.offsetHeight : 36) + 8);
  };

  useEffect(() => { if (!editing) setDraft(tile.text || ''); }, [tile.text, editing]);
  useEffect(() => {
    if (editing) placeToolbar();
    if (editing && areaRef.current) { areaRef.current.focus(); areaRef.current.select(); }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== tile.text) onChange({ text: draft });
  };
  const setStyle = patch => {
    onChange({ style: { ...st, ...patch } });
    // Formatting mid-edit hands the caret back to the text.
    if (editing) requestAnimationFrame(() => areaRef.current && areaRef.current.focus());
  };

  const dark = st.background && st.background !== 'transparent' && isDarkColor(st.background);
  const px = textStylePx(st);
  const family = (FONT_FAMILIES.find(f => f.id === st.font) || FONT_FAMILIES[0]).css;
  const decoration = [st.underline && 'underline', st.strike && 'line-through'].filter(Boolean).join(' ') || 'none';
  const boxStyle = {
    background: st.background === 'transparent' ? 'transparent' : st.background,
    color: st.color || (dark ? '#ffffff' : 'var(--color-ink)'),
    fontSize: `${px}px`,
    fontWeight: st.bold ? 700 : 400,
    fontStyle: st.italic ? 'italic' : 'normal',
    textAlign: st.align,
    justifyContent: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[st.valign],
    ...(family ? { fontFamily: family } : {}),
  };
  const sizeOptions = FONT_SIZES.includes(px) ? FONT_SIZES : [...FONT_SIZES, px].sort((a, b) => a - b);
  const toggle = (key, label, icon) => (
    <button type="button" className={`tt-btn${st[key] ? ' is-on' : ''}`} aria-pressed={!!st[key]} aria-label={label} title={label} onClick={() => setStyle({ [key]: !st[key] })}><i className={`ph ${icon}`} aria-hidden="true" /></button>
  );

  return (
    <div
      ref={frameRef}
      className={`text-tile-frame${editing ? ' is-editing' : ''}${above ? ' toolbar-above' : ''}`}
      onMouseEnter={placeToolbar}
      onBlur={e => { if (editing && !e.currentTarget.contains(e.relatedTarget)) commit(); }}
    >
      <div
        className="text-tile-toolbar"
        onMouseDown={e => {
          // The grip is the drag handle: its mousedown has to reach the grid
          // item, where react-grid-layout starts the drag.
          if (e.target.closest('.tile-drag-handle')) return;
          e.stopPropagation();
          // Keep the caret in the text while formatting (selects and the
          // color picker still need their default so they can open).
          if (editing && e.target.closest('button')) e.preventDefault();
        }}
      >
        <span className="tile-drag-handle text-tile-grip" title="Drag to move" aria-hidden="true"><i className="ph ph-dots-six-vertical" /></span>
        <select className="tt-select tt-font" aria-label="Font" title="Font" value={st.font || ''} onChange={e => setStyle({ font: e.target.value })}>
          {FONT_FAMILIES.map(f => <option key={f.id} value={f.id} style={f.css ? { fontFamily: f.css } : undefined}>{f.label}</option>)}
        </select>
        <select className="tt-select tt-size" aria-label="Font size" title="Font size" value={px} onChange={e => setStyle({ fontSize: Number(e.target.value) })}>
          {sizeOptions.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        {toggle('bold', 'Bold', 'ph-text-b')}
        {toggle('italic', 'Italic', 'ph-text-italic')}
        {toggle('underline', 'Underline', 'ph-text-underline')}
        {toggle('strike', 'Strikethrough', 'ph-text-strikethrough')}
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

      <div className={`text-tile${editing ? '' : ' tile-drag-handle'} size-${st.size}${family ? ' has-font' : ''}${st.background === 'transparent' ? ' is-transparent' : ''}${editing ? ' is-editing' : ''}`} style={boxStyle}>
      {editing ? (
        <textarea
          ref={areaRef}
          className="text-tile-input"
          style={{ fontSize: boxStyle.fontSize, fontWeight: boxStyle.fontWeight, fontStyle: boxStyle.fontStyle, textDecoration: decoration, textAlign: boxStyle.textAlign, color: boxStyle.color, ...(family ? { fontFamily: family } : {}) }}
          value={draft}
          aria-label="Text box content"
          placeholder={'# Heading\nWrite a note, a takeaway, or a section title.\n- bullets work too'}
          onChange={e => setDraft(e.target.value)}
          onMouseDown={e => e.stopPropagation()}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); setDraft(tile.text || ''); setEditing(false); }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
          }}
        />
      ) : (
        <div
          className="text-tile-content"
          style={{ textDecoration: decoration }}
          onDoubleClick={() => setEditing(true)}
          dangerouslySetInnerHTML={{ __html: tile.text ? renderTextMarkup(tile.text) : '<div class="tb-placeholder">Double-click to add text</div>' }}
        />
      )}
      </div>
    </div>
  );
}
