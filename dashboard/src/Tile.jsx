// dashboard/src/Tile.jsx — one dashboard tile: renders a chart via
// shared/chart-engine.js against the active previewMode's theme
// (shared/chart-themes.js), with edit/remove affordances. Clicking a tile
// opens TileEditor.jsx scoped to that tile's query + chart spec.
//
// Also exports the pieces TileEditor's live preview reuses, so the preview
// is literally the same render path as a committed tile:
//   - useTileChart(): run the SQL (via the bridge) -> analyze columns ->
//     resolve the stored name-based chartSpec -> chart data
//   - ChartCanvas: draws that chart as an SVG sized to its container
//   - TileFrame: the tile chrome (title, subtitle, background, border),
//     driven by the tile's `appearance`
//
// Text boxes are tiles too (kind: 'text') — see TextTile.jsx.

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

export const DEFAULT_APPEARANCE = {
  showTitle: true,
  subtitle: '',
  titleAlign: 'left',
  titleSize: 'md',
  titleColor: '',
  background: '',
  border: false,
};

const TITLE_SIZES = { sm: 13, md: 15, lg: 19, xl: 24 };

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
  if (tile.kind === 'text') return (tile.text || 'Text box').split('\n')[0].replace(/^#+\s*/, '').slice(0, 40) || 'Text box';
  if (tile.chartSpec && tile.chartSpec.title) return tile.chartSpec.title;
  const chart = chartFromResult(runTileQuery(tile.sql), tile.chartSpec);
  return (chart.spec && chart.spec.title) || 'Untitled tile';
}

export function useTileChart(sql, storedSpec, schemaVersion) {
  const result = useMemo(() => runTileQuery(sql), [sql, schemaVersion]);
  return useMemo(() => chartFromResult(result, storedSpec), [result, storedSpec]);
}

function hexLuminance(hex) {
  const c = String(hex || '').replace('#', '');
  if (c.length < 6) return 1;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const isDarkColor = hex => hexLuminance(hex) < 0.4;

// Chart ink that stays readable on the tile's own background.
export function surfaceOverrides(background) {
  if (!background) return null;
  if (background === 'transparent') return { surface: 'none' };
  if (isDarkColor(background)) {
    return { surface: background, text: '#ffffff', text2: '#c9cec5', grid: 'rgba(255,255,255,0.12)', axis: 'rgba(255,255,255,0.35)' };
  }
  return { surface: background };
}

// Draws at the container's real pixel width (1:1 text, no scaling blur),
// re-rendering when the tile is resized. Horizontal bar charts and tables
// can be taller than the tile — the body scrolls rather than squashing them.
export const ChartCanvas = memo(function ChartCanvas({ spec, data, previewMode = 'synth', compact = true, themeOverrides = null }) {
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
    if (!size || size.width < 60 || size.height < 40) return '';
    const theme = { ...getChartTheme(previewMode), ...(themeOverrides || {}) };
    return renderChartSVG(spec, data, theme, { width: size.width, height: size.height }, compact
      ? { showTitle: false, minPlotHeight: 80, minPieHeight: 140 }
      : { showTitle: false, minPlotHeight: 180, minPieHeight: 260 });
  }, [spec, data, size, previewMode, compact, themeOverrides]);

  return <div className="chart-canvas" ref={ref} dangerouslySetInnerHTML={{ __html: svg }} />;
});

// Tile chrome shared by committed tiles and the editor's preview card.
export function TileFrame({ title, appearance, actions, children, footnote, dragHandle = true, className = '' }) {
  const a = { ...DEFAULT_APPEARANCE, ...(appearance || {}) };
  const dark = a.background && a.background !== 'transparent' && isDarkColor(a.background);
  const style = {
    ...(a.background ? { '--tile-bg': a.background === 'transparent' ? 'transparent' : a.background } : {}),
    ...(a.border ? { '--tile-border': dark ? 'rgba(255,255,255,0.3)' : 'var(--color-ink)' } : {}),
    '--tile-title-color': a.titleColor || (dark ? '#ffffff' : 'var(--color-ink)'),
    '--tile-title-size': `${TITLE_SIZES[a.titleSize] || 15}px`,
  };
  return (
    <article className={`tile${dark ? ' is-dark' : ''}${a.showTitle ? '' : ' no-title'} ${className}`} style={style} aria-label={title}>
      <header className={`tile-header${dragHandle ? ' tile-drag-handle' : ''}`}>
        <div className="tile-heading" style={{ textAlign: a.titleAlign }}>
          {a.showTitle && <h3 className="tile-title" title={title}>{title}</h3>}
          {a.showTitle && a.subtitle && <p className="tile-subtitle">{a.subtitle}</p>}
        </div>
        {actions && <div className="tile-actions">{actions}</div>}
      </header>
      <div className="tile-body">{children}</div>
      {footnote && <footer className="tile-footnote">{footnote}</footer>}
    </article>
  );
}

export function TileMenu({ items }) {
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
    <div className="tile-menu" ref={ref}>
      <button type="button" className="tile-icon-btn" aria-label="Tile options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <i className="ph ph-dots-three" aria-hidden="true" />
      </button>
      {open && (
        <div className="tile-menu-popover" role="menu">
          {items.map(it => (
            <button key={it.label} type="button" role="menuitem" className={it.danger ? 'is-danger' : ''} onClick={() => { setOpen(false); it.onClick(); }}>
              <i className={`ph ${it.icon}`} aria-hidden="true" /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Tile({ tile, schemaVersion, previewMode, onEdit, onFormat, onDuplicate, onRemove }) {
  const chart = useTileChart(tile.sql, tile.chartSpec, schemaVersion);
  const title = (tile.chartSpec && tile.chartSpec.title) || (chart.spec && chart.spec.title) || 'Untitled tile';
  const background = tile.appearance && tile.appearance.background;
  const overrides = useMemo(() => surfaceOverrides(background), [background]);
  const truncated = chart.result && chart.result.truncated;
  const shownNote = chart.data && chart.data.shown < chart.data.total && !chart.data.pivoted && !chart.data.kpi
    ? `Showing the first ${chart.data.shown.toLocaleString()} of ${chart.data.total.toLocaleString()}${truncated ? '+' : ''} rows`
    : null;

  return (
    <TileFrame
      title={title}
      appearance={tile.appearance}
      footnote={shownNote}
      actions={(
        <>
          <button type="button" className="tile-icon-btn" aria-label={`Edit ${title}`} title="Edit tile" onClick={onEdit}>
            <i className="ph ph-pencil-simple" aria-hidden="true" />
          </button>
          <TileMenu items={[
            { label: 'Edit data & chart', icon: 'ph-pencil-simple', onClick: onEdit },
            { label: 'Colors & format', icon: 'ph-palette', onClick: onFormat },
            { label: 'Duplicate', icon: 'ph-copy', onClick: onDuplicate },
            { label: 'Remove', icon: 'ph-trash', onClick: onRemove, danger: true },
          ]} />
        </>
      )}
    >
      <div className="tile-chart" onDoubleClick={onEdit}>
        {chart.error ? (
          <div className={`tile-message${chart.kind === 'query' ? ' is-error' : ''}`}>
            <i className={`ph ${chart.kind === 'query' ? 'ph-warning-circle' : 'ph-chart-bar'}`} aria-hidden="true" />
            <span>{chart.error}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit}>Edit tile</button>
          </div>
        ) : (
          <ChartCanvas spec={chart.spec} data={chart.data} previewMode={previewMode} themeOverrides={overrides} />
        )}
      </div>
    </TileFrame>
  );
}
