// dashboard/src/Segmented.jsx — the one mode-toggle control used everywhere
// a mode is picked: TileEditor's Visual / SQL, AiPanel's Ask / Agent, and
// (v1.1) the "Preview as" Synth / Power BI / Tableau switch. Same
// interaction pattern as synth-sql's SQL/General toggle — a tablist of
// pill buttons, the active one lifted onto a white surface — so every mode
// switch in the app reads as the same kind of thing.

export default function Segmented({ options, value, onChange, label, size = 'md' }) {
  const onKeyDown = e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const enabled = options.filter(o => !o.disabled);
    const i = enabled.findIndex(o => o.id === value);
    const next = enabled[(i + (e.key === 'ArrowRight' ? 1 : enabled.length - 1)) % enabled.length];
    if (next) onChange(next.id);
  };
  return (
    <div className={`segmented segmented-${size}`} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={o.id === value}
          tabIndex={o.id === value ? 0 : -1}
          className={`segmented-btn${o.id === value ? ' is-active' : ''}`}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.id)}
        >
          {o.icon && <i className={`ph ${o.icon}`} aria-hidden="true" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
