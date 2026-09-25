// dashboard/src/Dashboard.jsx — the dashboard canvas: tile grid (drag/resize
// via react-grid-layout), "+ Add tile" entry point into TileEditor, and the
// AI panel (AiPanel.jsx) alongside it. Reads/writes tiles through
// ./bridge.js — never owns tile state independently of the shell.
//
// The "Preview as: Synth / Power BI / Tableau" toggle (initial-build.md
// §8a) is sequenced into v1.1; the canvas already renders every tile
// through bridge.getPreviewMode() and carries data-preview on its root, so
// adding it is a header control + dashboard/src/themes/*.css, nothing more.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import GridLayout from 'react-grid-layout';
import { bridge, useSchema, useTiles, useCurrentUser } from './bridge.js';
import Tile, { tileDisplayTitle } from './Tile.jsx';
import TileEditor from './TileEditor.jsx';
import AiPanel from './AiPanel.jsx';

const GRID_COLS = 12;
const ROW_HEIGHT = 56;
const GRID_MARGIN = [16, 16];
const DEFAULT_TILE_SIZE = { w: 6, h: 6 };
const STACK_BREAKPOINT = 640;
const AI_PANEL_PREF_KEY = 'synthbi_ai_panel_v1';

function newTileId() {
  return `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

// Next free slot: alternate left/right halves at the bottom of the grid —
// react-grid-layout's vertical compaction then floats it up into any gap.
function nextPosition(tiles) {
  const bottom = tiles.reduce((max, t) => Math.max(max, t.position.y + t.position.h), 0);
  return { x: (tiles.length % 2) * DEFAULT_TILE_SIZE.w, y: bottom, ...DEFAULT_TILE_SIZE };
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

export default function Dashboard() {
  const { schema, version: schemaVersion } = useSchema();
  const tiles = useTiles();
  const user = useCurrentUser();
  const previewMode = bridge.getPreviewMode();

  const [editor, setEditor] = useState(null); // null | { tileId } | { isNew: true } | { draft }
  const [toast, setToast] = useState(null);   // { message, undo? }
  const [panel, setPanel] = useState(() => ({ open: true, width: 380, ...(readPanelPref() || {}) }));
  const [gridWrapRef, gridWidth] = useElementWidth();
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
  const toastTimer = useRef(null);
  const openerRef = useRef(null);

  useEffect(() => writePanelPref(panel), [panel]);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = useCallback((message, undo) => {
    clearTimeout(toastTimer.current);
    setToast({ message, undo });
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  const openEditor = (state) => {
    openerRef.current = document.activeElement;
    setEditor(state);
  };
  const closeEditor = () => {
    setEditor(null);
    const opener = openerRef.current;
    if (opener && document.body.contains(opener)) requestAnimationFrame(() => opener.focus());
  };

  // ---- tile mutations (all go through bridge.setTiles) ----
  const addTile = useCallback(({ sql, chartSpec, source }) => {
    const current = bridge.getTiles();
    const tile = { id: newTileId(), sql, chartSpec, source, position: nextPosition(current) };
    bridge.setTiles([...current, tile]);
    return tile;
  }, []);

  const saveFromEditor = fields => {
    if (editor && editor.tileId) {
      bridge.setTiles(bridge.getTiles().map(t => (t.id === editor.tileId ? { ...t, ...fields } : t)));
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
    showToast('Tile duplicated');
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

  const layout = useMemo(() => tiles.map(t => ({ i: t.id, ...t.position, minW: 3, minH: 3 })), [tiles]);

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

  if (!schema.length) return null;

  const editingTile = editor && editor.tileId ? tiles.find(t => t.id === editor.tileId) : null;
  const stacked = gridWidth > 0 && gridWidth < STACK_BREAKPOINT;

  const renderTile = tile => (
    <Tile
      tile={tile}
      schemaVersion={schemaVersion}
      previewMode={previewMode}
      onEdit={() => openEditor({ tileId: tile.id })}
      onDuplicate={() => duplicateTile(tile.id)}
      onRemove={() => removeTile(tile.id)}
    />
  );

  return (
    <div className="dash" data-preview={previewMode} style={{ '--ai-panel-width': `${panel.width}px` }}>
      <section className="dash-canvas" aria-label="Dashboard canvas">
        <div className="dash-header">
          <div className="dash-header-left">
            <h2 className="dash-title">Dashboard</h2>
            <span className="dash-count">{tiles.length ? `${tiles.length} tile${tiles.length === 1 ? '' : 's'}` : 'No tiles yet'}</span>
          </div>
          <div className="dash-header-right">
            {!panel.open && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPanel(p => ({ ...p, open: true }))}>
                <i className="ph ph-sparkle" aria-hidden="true" /> Assistant
              </button>
            )}
            {tiles.length > 0 && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEditor({ isNew: true })}>
                <i className="ph ph-plus" aria-hidden="true" /> Add tile
              </button>
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
                  {user && panel.open && <span className="dash-empty-or">or just ask the assistant <i className="ph ph-arrow-right" aria-hidden="true" /></span>}
                </div>
              </div>
            </div>
          ) : stacked ? (
            <div className="dash-stack">
              {tiles.map(tile => <div key={tile.id} className="dash-stack-item">{renderTile(tile)}</div>)}
            </div>
          ) : gridWidth > 0 && (
            <GridLayout
              className={`dash-grid${gridSettled ? ' is-settled' : ''}`}
              layout={layout}
              cols={GRID_COLS}
              rowHeight={ROW_HEIGHT}
              width={gridWidth}
              margin={GRID_MARGIN}
              containerPadding={[0, 0]}
              compactType="vertical"
              draggableHandle=".tile-drag-handle"
              draggableCancel=".tile-actions"
              resizeHandles={['se']}
              onLayoutChange={onLayoutChange}
            >
              {tiles.map(tile => <div key={tile.id}>{renderTile(tile)}</div>)}
            </GridLayout>
          )}
        </div>
      </section>

      {panel.open && (
        <>
          <div className="dash-resizer" role="separator" aria-orientation="vertical" aria-label="Resize assistant panel" onPointerDown={startPanelResize} />
          <AiPanel onCollapse={() => setPanel(p => ({ ...p, open: false }))} />
        </>
      )}

      {editor && (
        <TileEditor
          key={editor.tileId || (editor.draft ? 'draft' : 'new')}
          tile={editingTile}
          draft={editor.draft}
          schema={schema}
          schemaVersion={schemaVersion}
          previewMode={previewMode}
          onSave={saveFromEditor}
          onClose={closeEditor}
        />
      )}

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
