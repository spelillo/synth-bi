// dashboard/src/Dashboard.jsx — the dashboard canvas: tile grid (drag/resize
// via react-grid-layout), "+ Add tile" entry point into TileEditor, text
// boxes, canvas styling, Export, and the AI panel (AiPanel.jsx) alongside
// it. Reads/writes tiles through ./bridge.js — never owns tile state
// independently of the shell.
//
// The canvas works like a slide: by default tiles stay exactly where
// they're dropped (layout 'free'); the Style menu can switch to 'flow',
// where tiles float up to fill gaps. Positions live on a fine 24-column
// grid so charts and text boxes can be sized and placed precisely.
//
// The "Preview as: Synth / Power BI / Tableau" toggle (initial-build.md
// §8a) is sequenced into v1.1; the canvas already renders every tile
// through bridge.getPreviewMode() and carries data-preview on its root, so
// adding it is a header control + dashboard/src/themes/*.css, nothing more.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import GridLayout from 'react-grid-layout';
import { bridge, useSchema, useTiles, useCurrentUser, useDashboardSettings } from './bridge.js';
import Tile, { tileDisplayTitle } from './Tile.jsx';
import TextTile, { SwatchPicker } from './TextTile.jsx';
import TileEditor from './TileEditor.jsx';
import AiPanel from './AiPanel.jsx';
import ExportModal from './ExportModal.jsx';
import Segmented from './Segmented.jsx';

export const GRID_COLS = 24;
const ROW_HEIGHT = 20;
const SPACING = { compact: [8, 8], comfortable: [14, 14], roomy: [22, 22] };
const DEFAULT_TILE_SIZE = { w: 12, h: 15 };
const DEFAULT_TEXT_SIZE = { w: 12, h: 6 };
const STACK_BREAKPOINT = 640;
const AI_PANEL_PREF_KEY = 'synthbi_ai_panel_v1';
const CANVAS_SWATCHES = ['', '#ffffff', '#f4f7f2', '#e2f6d5', '#0e0f0c', '#163300'];

export function newTileId() {
  return `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// Next free slot: alternate left/right halves at the bottom of the canvas.
export function nextPosition(tiles, size = DEFAULT_TILE_SIZE) {
  const bottom = tiles.reduce((max, t) => Math.max(max, t.position.y + t.position.h), 0);
  const lastRow = tiles.filter(t => t.position.y + t.position.h === bottom);
  const rightFree = lastRow.length === 1 && lastRow[0].position.x + lastRow[0].position.w <= GRID_COLS - size.w;
  if (rightFree && size.w <= GRID_COLS / 2) {
    return { x: GRID_COLS - size.w, y: lastRow[0].position.y, ...size };
  }
  return { x: 0, y: bottom, ...size };
}

function readPanelPref() {
  try {
    const raw = localStorage.getItem(AI_PANEL_PREF_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePanelPref(pref) {
  try { localStorage.setItem(AI_PANEL_PREF_KEY, JSON.stringify(pref)); } catch { /* private mode etc. — preference just won't stick */ }
}

// Callback-ref measurement: the grid wrapper doesn't exist until a file is
// loaded (Dashboard renders nothing before that), so this has to attach
// whenever the element actually appears, not once on mount.
function useElementWidth() {
  const [el, setEl] = useState(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return undefined;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width];
}

function StyleMenu({ settings, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="style-menu" ref={ref}>
      <button type="button" className="btn btn-secondary btn-sm" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <i className="ph ph-paint-brush-broad" aria-hidden="true" /> Style
      </button>
      {open && (
        <div className="style-popover" role="dialog" aria-label="Dashboard style">
          <div className="field">
            <span className="field-label">Canvas background</span>
            <div className="swatch-picker">
              {CANVAS_SWATCHES.map(c => (
                <button key={c || 'default'} type="button" className={`swatch${(settings.background || '') === c ? ' is-active' : ''}`} style={{ background: c || 'var(--color-canvas-soft)' }} aria-label={c || 'Default sage'} title={c || 'Default sage'} onClick={() => onChange({ background: c })} />
              ))}
              <label className="swatch swatch-custom" title="Custom color">
                <input type="color" value={settings.background || '#e8ebe6'} onChange={e => onChange({ background: e.target.value })} aria-label="Custom canvas color" />
                <i className="ph ph-eyedropper" aria-hidden="true" />
              </label>
            </div>
          </div>
          <div className="field">
            <span className="field-label">Layout</span>
            <Segmented size="sm" label="Layout" value={settings.layout} onChange={v => onChange({ layout: v })} options={[{ id: 'free', label: 'Free (like a slide)' }, { id: 'flow', label: 'Snap up' }]} />
          </div>
          <div className="field">
            <span className="field-label">Spacing</span>
            <Segmented size="sm" label="Spacing" value={settings.spacing} onChange={v => onChange({ spacing: v })} options={[{ id: 'compact', label: 'Compact' }, { id: 'comfortable', label: 'Comfortable' }, { id: 'roomy', label: 'Roomy' }]} />
          </div>
          <div className="field">
            <span className="field-label">Tile corners</span>
            <Segmented size="sm" label="Tile corners" value={settings.corners} onChange={v => onChange({ corners: v })} options={[{ id: 'rounded', label: 'Rounded' }, { id: 'soft', label: 'Soft' }, { id: 'square', label: 'Square' }]} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { schema, version: schemaVersion } = useSchema();
  const tiles = useTiles();
  const user = useCurrentUser();
  const settings = useDashboardSettings();
  const previewMode = bridge.getPreviewMode();

  const [editor, setEditor] = useState(null); // null | { tileId, panel? } | { isNew: true } | { draft }
  const [exportOpen, setExportOpen] = useState(false);
  const [toast, setToast] = useState(null);   // { message, undo? }
  const [freshTextId, setFreshTextId] = useState(null);
  const [panel, setPanel] = useState(() => ({ open: true, width: 380, ...(readPanelPref() || {}) }));
  const [gridWrapRef, gridWidth] = useElementWidth();
  const toastTimer = useRef(null);
  const openerRef = useRef(null);

  // react-grid-layout animates every item from the grid origin on first
  // mount; transitions only switch on once the initial layout has painted,
  // so opening a dashboard doesn't visibly fly its tiles into place.
  const [gridSettled, setGridSettled] = useState(false);
  const gridMounted = tiles.length > 0 && gridWidth > 0;
  useEffect(() => {
    if (!gridMounted) { setGridSettled(false); return undefined; }
    const t = setTimeout(() => setGridSettled(true), 250);
    return () => clearTimeout(t);
  }, [gridMounted]);

  useEffect(() => writePanelPref(panel), [panel]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = useCallback((message, undo) => {
    clearTimeout(toastTimer.current);
    setToast({ message, undo });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  const openEditor = state => {
    openerRef.current = document.activeElement;
    setEditor(state);
  };
  const closeEditor = () => {
    setEditor(null);
    const opener = openerRef.current;
    if (opener && document.body.contains(opener)) requestAnimationFrame(() => opener.focus());
  };

  // ---- tile mutations (all go through bridge.setTiles) ----
  const addTile = useCallback(({ targetTileId, note, key, ...fields }) => {
    const current = bridge.getTiles();
    const tile = { id: newTileId(), ...fields, position: nextPosition(current) };
    bridge.setTiles([...current, tile]);
    return tile;
  }, []);

  const updateTile = (id, patch) => {
    bridge.setTiles(bridge.getTiles().map(t => (t.id === id ? { ...t, ...patch } : t)));
  };

  const addTextBox = () => {
    const current = bridge.getTiles();
    const tile = { id: newTileId(), kind: 'text', text: '', style: { size: 'lg' }, position: nextPosition(current, DEFAULT_TEXT_SIZE) };
    bridge.setTiles([...current, tile]);
    setFreshTextId(tile.id);
  };

  const updateTileFields = (id, { targetTileId, note, key, ...fields }) => updateTile(id, fields);

  const saveFromEditor = fields => {
    if (editor && editor.tileId) {
      updateTileFields(editor.tileId, fields);
      showToast('Tile updated');
    } else {
      addTile(fields);
      showToast('Tile added to the dashboard');
    }
    closeEditor();
  };

  const removeTile = id => {
    const before = bridge.getTiles();
    const removed = before.find(t => t.id === id);
    if (!removed) return;
    const title = tileDisplayTitle(removed);
    bridge.setTiles(before.filter(t => t.id !== id));
    showToast(`Removed “${title}”`, () => {
      const now = bridge.getTiles();
      if (!now.some(t => t.id === id)) bridge.setTiles([...now, removed]);
      setToast(null);
    });
  };

  const duplicateTile = id => {
    const current = bridge.getTiles();
    const src = current.find(t => t.id === id);
    if (!src) return;
    const copy = { ...src, id: newTileId(), position: { ...src.position, y: src.position.y + src.position.h } };
    bridge.setTiles([...current, copy]);
    showToast(src.kind === 'text' ? 'Text box duplicated' : 'Tile duplicated');
  };

  const onLayoutChange = layout => {
    const byId = new Map(layout.map(l => [l.i, l]));
    let changed = false;
    const next = bridge.getTiles().map(t => {
      const l = byId.get(t.id);
      if (!l) return t;
      const p = t.position;
      if (p.x === l.x && p.y === l.y && p.w === l.w && p.h === l.h) return t;
      changed = true;
      return { ...t, position: { x: l.x, y: l.y, w: l.w, h: l.h } };
    });
    if (changed) bridge.setTiles(next);
  };

  const layout = useMemo(() => tiles.map(t => ({
    i: t.id,
    ...t.position,
    minW: t.kind === 'text' ? 3 : 5,
    minH: t.kind === 'text' ? 2 : 6,
  })), [tiles]);

  // ---- AI panel resize ----
  const startPanelResize = e => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panel.width;
    const onMove = ev => setPanel(p => ({ ...p, width: Math.min(620, Math.max(300, startW + (startX - ev.clientX))) }));
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.body.classList.remove('is-resizing-panel');
    };
    document.body.classList.add('is-resizing-panel');
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  };

  const requestExport = () => setExportOpen(true);

  if (!schema.length) return null;

  const editingTile = editor && editor.tileId ? tiles.find(t => t.id === editor.tileId) : null;
  const stacked = gridWidth > 0 && gridWidth < STACK_BREAKPOINT;
  const chartCount = tiles.filter(t => t.kind !== 'text').length;
  const margin = SPACING[settings.spacing] || SPACING.comfortable;

  const renderTile = tile => (tile.kind === 'text' ? (
    <TextTile
      tile={tile}
      autoEdit={tile.id === freshTextId}
      onChange={patch => { if (tile.id === freshTextId) setFreshTextId(null); updateTile(tile.id, patch); }}
      onDuplicate={() => duplicateTile(tile.id)}
      onRemove={() => removeTile(tile.id)}
    />
  ) : (
    <Tile
      tile={tile}
      schemaVersion={schemaVersion}
      previewMode={previewMode}
      onEdit={() => openEditor({ tileId: tile.id })}
      onFormat={() => openEditor({ tileId: tile.id, panel: 'format' })}
      onDuplicate={() => duplicateTile(tile.id)}
      onRemove={() => removeTile(tile.id)}
    />
  ));

  return (
    <div
      className={`dash corners-${settings.corners}`}
      data-preview={previewMode}
      style={{ '--ai-panel-width': `${panel.width}px`, ...(settings.background ? { '--dash-bg': settings.background } : {}) }}
    >
      <section className="dash-canvas" aria-label="Dashboard canvas">
        <div className="dash-header">
          <div className="dash-header-left">
            <h2 className="dash-title">Dashboard</h2>
            <span className="dash-count">{chartCount ? `${chartCount} tile${chartCount === 1 ? '' : 's'}` : 'No tiles yet'}</span>
          </div>
          <div className="dash-header-right">
            {!panel.open && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPanel(p => ({ ...p, open: true }))}>
                <i className="ph ph-sparkle" aria-hidden="true" /> Assistant
              </button>
            )}
            {tiles.length > 0 && (
              <>
                <button type="button" className="btn btn-secondary btn-sm" onClick={addTextBox}>
                  <i className="ph ph-text-t" aria-hidden="true" /> Text
                </button>
                <StyleMenu settings={settings} onChange={patch => bridge.setDashboardSettings(patch)} />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditor({ isNew: true })}>
                  <i className="ph ph-plus" aria-hidden="true" /> Add tile
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={requestExport} disabled={!chartCount}>
                  <i className="ph ph-export" aria-hidden="true" /> Export
                </button>
              </>
            )}
          </div>
        </div>

        <div className="dash-grid-wrap" ref={gridWrapRef}>
          {tiles.length === 0 ? (
            <div className="dash-empty">
              <div className="dash-empty-card">
                <div className="dash-empty-art" aria-hidden="true">
                  <span /><span /><span /><span />
                </div>
                <h3>Build your first tile</h3>
                <p>Pick a table, what to group by, and what to measure — or write the SQL yourself. Every tile is its own query and chart.</p>
                <div className="dash-empty-actions">
                  <button type="button" className="btn btn-primary" onClick={() => openEditor({ isNew: true })}>
                    <i className="ph ph-plus" aria-hidden="true" /> Add your first tile
                  </button>
                  <button type="button" className="link-btn" onClick={addTextBox}>or start with a title text box</button>
                  {user && panel.open && <span className="dash-empty-or">or describe it to the assistant <i className="ph ph-arrow-right" aria-hidden="true" /></span>}
                </div>
              </div>
            </div>
          ) : stacked ? (
            <div className="dash-stack">
              {tiles.map(tile => <div key={tile.id} className={`dash-stack-item${tile.kind === 'text' ? ' is-text' : ''}`}>{renderTile(tile)}</div>)}
            </div>
          ) : gridWidth > 0 && (
            <GridLayout
              className={`dash-grid${gridSettled ? ' is-settled' : ''}`}
              layout={layout}
              cols={GRID_COLS}
              rowHeight={ROW_HEIGHT}
              width={gridWidth}
              margin={margin}
              containerPadding={[0, 0]}
              compactType={settings.layout === 'flow' ? 'vertical' : null}
              preventCollision={false}
              draggableHandle=".tile-drag-handle"
              draggableCancel=".tile-actions, .text-tile-toolbar button, .text-tile-toolbar select, .tt-popover, .text-tile-input"
              resizeHandles={['se', 'e', 's']}
              onLayoutChange={onLayoutChange}
            >
              {tiles.map(tile => <div key={tile.id} className={tile.kind === 'text' ? 'grid-item-text' : ''}>{renderTile(tile)}</div>)}
            </GridLayout>
          )}
        </div>
      </section>

      {panel.open && (
        <>
          <div className="dash-resizer" role="separator" aria-orientation="vertical" aria-label="Resize assistant panel" onPointerDown={startPanelResize} />
          <AiPanel
            onCollapse={() => setPanel(p => ({ ...p, open: false }))}
            onReviewDraft={draft => openEditor(draft.targetTileId ? { tileId: draft.targetTileId, draft } : { draft })}
            onAddDraft={draft => {
              const { targetTileId, note, key, ...fields } = draft;
              if (targetTileId) { updateTile(targetTileId, fields); showToast('Tile updated'); }
              else { addTile(fields); showToast('Tile added to the dashboard'); }
            }}
            onAddText={textBox => {
              const current = bridge.getTiles();
              const tile = { id: newTileId(), ...textBox, position: nextPosition(current, DEFAULT_TEXT_SIZE) };
              bridge.setTiles([...current, tile]);
              return tile.id;
            }}
            onRemoveTile={id => bridge.setTiles(bridge.getTiles().filter(t => t.id !== id))}
          />
        </>
      )}

      {editor && (
        <TileEditor
          key={`${editor.tileId || 'new'}-${editor.draft ? editor.draft.key || 'draft' : ''}`}
          tile={editingTile}
          draft={editor.draft}
          initialPanel={editor.panel || (editor.draft ? 'visual' : undefined)}
          schema={schema}
          schemaVersion={schemaVersion}
          previewMode={previewMode}
          onSave={saveFromEditor}
          onClose={closeEditor}
        />
      )}

      {exportOpen && <ExportModal tiles={tiles} schema={schema} onClose={() => setExportOpen(false)} />}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.message}</span>
          {toast.undo && <button type="button" className="toast-action" onClick={toast.undo}>Undo</button>}
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => setToast(null)}><i className="ph ph-x" aria-hidden="true" /></button>
        </div>
      )}
    </div>
  );
}
