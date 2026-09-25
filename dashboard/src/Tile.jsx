// dashboard/src/Tile.jsx — one dashboard tile: renders a chart via
// shared/chart-engine.js against the active previewMode's theme
// (shared/chart-themes.js), with edit/remove affordances. Clicking a tile
// opens TileEditor.jsx scoped to that tile's query + chart spec.
//
// Also exports the two pieces TileEditor's live preview reuses, so the
// preview is literally the same render path as a committed tile:
//   - useTileChart(): run the SQL (via the bridge) -> analyze columns ->
//     resolve the stored name-based chartSpec -> chart data
//   - ChartCanvas: draws that chart as an SVG sized to its container

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { bridge } from './bridge.js';
import {
  analyzeChartColumns,
  buildChartData,
  chartDataIsEmpty,
  renderChartSVG,
  resolveChartSpec,
} from '../../shared/chart-engine.js';
import { getChartTheme } from '../../shared/chart-themes.js';

export function runTileQuery(sql) {
  try {
    return bridge.runQuery(sql);
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

// result: { columns, rows, truncated } | { error }. Returns everything a
// renderer needs, or { error } with a message fit for the tile body.
export function chartFromResult(result, storedSpec) {
  if (!result) return { error: 'Run the query to preview it.' };
  if (result.error) return { error: result.error, kind: 'query' };
  if (!result.columns.length || !result.rows.length) return { error: 'This query returned no rows.', kind: 'empty', result };
  const info = analyzeChartColumns(result.columns, result.rows);
  const spec = resolveChartSpec(storedSpec, info, result.rows.length);
  if (spec.error) return { error: spec.error, kind: 'spec', result, info };
  const data = buildChartData(spec, result.columns, result.rows);
  if (chartDataIsEmpty(spec, data)) return { error: 'Nothing to plot — the value column has no numbers.', kind: 'spec', result, info, spec };
  return { result, info, spec, data };
}

// The title a tile actually shows: the user's own, or the auto-generated
// one (stored as '' so it keeps tracking the query) resolved from its data.
export function tileDisplayTitle(tile) {
  if (tile.chartSpec && tile.chartSpec.title) return tile.chartSpec.title;
  const chart = chartFromResult(runTileQuery(tile.sql), tile.chartSpec);
  return (chart.spec && chart.spec.title) || 'Untitled tile';
}

export function useTileChart(sql, storedSpec, schemaVersion) {
  const result = useMemo(() => runTileQuery(sql), [sql, schemaVersion]);
  return useMemo(() => chartFromResult(result, storedSpec), [result, storedSpec]);
}

// Draws at the container's real pixel width (1:1 text, no scaling blur),
// re-rendering when the tile is resized. Horizontal bar charts can be
// taller than the tile — the body scrolls rather than squashing them.
export const ChartCanvas = memo(function ChartCanvas({ spec, data, previewMode = 'synth', compact = true }) {
  const ref = useRef(null);
  const [size, setSize] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      const h = Math.floor(el.clientHeight);
      setSize(prev => (prev && Math.abs(prev.width - w) < 4 && Math.abs(prev.height - h) < 4 ? prev : { width: w, height: h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const svg = useMemo(() => {
    if (!size || size.width < 80 || size.height < 60) return '';
    const theme = getChartTheme(previewMode);
    return renderChartSVG(spec, data, theme, { width: size.width, height: size.height }, compact
      ? { showTitle: false, minPlotHeight: 90, minPieHeight: 160 }
      : { showTitle: false, minPlotHeight: 200, minPieHeight: 280 });
  }, [spec, data, size, previewMode, compact]);

  return <div className="chart-canvas" ref={ref} dangerouslySetInnerHTML={{ __html: svg }} />;
});

function TileMenu({ onEdit, onDuplicate, onRemove }) {
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
  const pick = fn => () => { setOpen(false); fn(); };
  return (
    <div className="tile-menu" ref={ref}>
      <button type="button" className="tile-icon-btn" aria-label="Tile options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <i className="ph ph-dots-three" aria-hidden="true" />
      </button>
      {open && (
        <div className="tile-menu-popover" role="menu">
          <button type="button" role="menuitem" onClick={pick(onEdit)}><i className="ph ph-pencil-simple" aria-hidden="true" /> Edit tile</button>
          <button type="button" role="menuitem" onClick={pick(onDuplicate)}><i className="ph ph-copy" aria-hidden="true" /> Duplicate</button>
          <button type="button" role="menuitem" className="is-danger" onClick={pick(onRemove)}><i className="ph ph-trash" aria-hidden="true" /> Remove</button>
        </div>
      )}
    </div>
  );
}

export default function Tile({ tile, schemaVersion, previewMode, onEdit, onDuplicate, onRemove }) {
  const chart = useTileChart(tile.sql, tile.chartSpec, schemaVersion);
  const title = (tile.chartSpec && tile.chartSpec.title) || (chart.spec && chart.spec.title) || 'Untitled tile';
  const truncated = chart.result && chart.result.truncated;
  const shownNote = chart.data && chart.data.shown < chart.data.total
    ? `Showing the first ${chart.data.shown.toLocaleString()} of ${chart.data.total.toLocaleString()}${truncated ? '+' : ''} rows`
    : null;

  return (
    <article className="tile" aria-label={title}>
      <header className="tile-header tile-drag-handle">
        <h3 className="tile-title" title={title}>{title}</h3>
        <div className="tile-actions">
          <button type="button" className="tile-icon-btn" aria-label={`Edit ${title}`} title="Edit tile" onClick={onEdit}>
            <i className="ph ph-pencil-simple" aria-hidden="true" />
          </button>
          <TileMenu onEdit={onEdit} onDuplicate={onDuplicate} onRemove={onRemove} />
        </div>
      </header>
      <div className="tile-body" onDoubleClick={onEdit}>
        {chart.error ? (
          <div className={`tile-message${chart.kind === 'query' ? ' is-error' : ''}`}>
            <i className={`ph ${chart.kind === 'query' ? 'ph-warning-circle' : 'ph-chart-bar'}`} aria-hidden="true" />
            <span>{chart.error}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit}>Edit tile</button>
          </div>
        ) : (
          <ChartCanvas spec={chart.spec} data={chart.data} previewMode={previewMode} />
        )}
      </div>
      {shownNote && <footer className="tile-footnote">{shownNote}</footer>}
    </article>
  );
}
