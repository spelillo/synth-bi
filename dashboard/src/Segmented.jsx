// dashboard/src/Segmented.jsx — the one mode-toggle control used everywhere
// a mode is picked: TileEditor's Visual / SQL, AiPanel's Ask / Agent, and
// (v1.1) the "Preview as" Synth / Power BI / Tableau switch. Same
// interaction pattern as synth-sql's SQL/General toggle — a tablist of
// pill buttons, the active one lifted onto a white surface — so every mode
// switch in the app reads as the same kind of thing.
//
// The white "lifted" surface is one thumb that slides between options on a
// spring, rather than jumping, so the change reads as one object moving.

import { useLayoutEffect, useRef, useState } from 'react';

export default function Segmented({ options, value, onChange, label, size = 'md' }) {
  const ref = useRef(null);
  const [thumb, setThumb] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      const active = el.querySelector('.segmented-btn.is-active');
      if (!active) { setThumb(null); return; }
      const next = { x: active.offsetLeft, y: active.offsetTop, w: active.offsetWidth, h: active.offsetHeight };
      setThumb(prev => (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h ? prev : { ...next, ready: !!prev }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, options.length]);
  const onKeyDown = e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const enabled = options.filter(o => !o.disabled);
    const i = enabled.findIndex(o => o.id === value);
    const next = enabled[(i + (e.key === 'ArrowRight' ? 1 : enabled.length - 1)) % enabled.length];
    if (next) onChange(next.id);
  };
  return (
    <div ref={ref} className={`segmented segmented-${size}${thumb ? ' has-thumb' : ''}`} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {thumb && (
        <span
          className={`segmented-thumb${thumb.ready ? ' is-ready' : ''}`}
          aria-hidden="true"
          style={{ width: thumb.w, height: thumb.h, transform: `translate(${thumb.x}px, ${thumb.y}px)` }}
        />
      )}
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={o.id === value}
          tabIndex={o.id === value ? 0 : -1}
          className={`segmented-btn${o.id === value ? ' is-active' : ''}`}
          disabled={o.disabled}
          title={o.title || o.ariaLabel}
          aria-label={o.ariaLabel}
          onClick={() => onChange(o.id)}
        >
          {o.icon && <i className={`ph ${o.icon}`} aria-hidden="true" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
