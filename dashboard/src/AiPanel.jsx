// dashboard/src/AiPanel.jsx — the AI assistant panel living alongside the
// dashboard canvas (replaces synth-sql's separate "Query & Chat" tab — see
// initial-build.md §9). Hosts the Ask / Build mode toggle (same visual
// pattern as synth-sql's SQL/General toggle):
//
//   - Ask: questions about the data, the dashboard, or how to build a
//     visual. Queries in a reply run locally (chat.js) and their results
//     show inline — the numbers never go back to the model. Any query can
//     be turned into a tile ("Make a tile").
//   - Build: describe the visual (fields, type, colors, title). The draft
//     opens straight away in the tile editor as a preview to fine-tune;
//     nothing lands on the dashboard until the user adds it. Text-box
//     requests are added directly (they're one click to edit or remove).
//
// Disabled entirely in Lite Mode (no sign-in) — see bridge.js's
// getCurrentUser()/requireSignIn().

import { useEffect, useMemo, useRef, useState } from 'react';
import { bridge, useAiMode, useCurrentUser, useSchema } from './bridge.js';
import Segmented from './Segmented.jsx';
import { splitReply, highlightSQL } from './lib/markdown.js';
import { CHART_TYPES } from '../../shared/chart-engine.js';

const MODE_HINT = {
  ask: 'Ask about your data, your dashboard, or how to build a chart. Numbers are computed here in your browser.',
  build: 'Describe the visual you want — fields, chart type, colors, a title. It opens as a preview you can fine-tune.',
};

function suggestionsFor(mode, schema) {
  const t = schema[0];
  if (!t) return [];
  const num = t.columns.find(c => c.kind === 'numeric' && !/(^|_)id$/i.test(c.name));
  const date = t.columns.find(c => c.kind === 'date' && c.isoDate);
  const text = t.columns.find(c => c.kind === 'text' && !/(^|_)id$/i.test(c.name));
  const pretty = s => String(s).replace(/_/g, ' ').toLowerCase();
  if (mode === 'ask') {
    return [
      `What's in the ${t.name} table?`,
      num && text ? `Which ${pretty(text.name)} has the highest total ${pretty(num.name)}?` : null,
      'How do I make a stacked column chart?',
      schema.length > 1 ? `How do ${schema[0].name} and ${schema[1].name} relate?` : null,
    ].filter(Boolean);
  }
  return [
    num && date ? `${pretty(num.name)} by month as a smooth line` : null,
    num && text ? `Top 10 ${pretty(text.name)} by ${pretty(num.name)}, horizontal bars in our green` : null,
    num ? `A KPI card for total ${pretty(num.name)} on a dark background` : null,
    'Add a title text box for this dashboard',
  ].filter(Boolean);
}

function ResultTable({ result }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? result.rows.slice(0, 200) : result.rows.slice(0, 8);
  const numeric = result.columns.map((_, j) => result.rows.slice(0, 50).every(r => r[j] === null || r[j] === '' || !isNaN(Number(r[j]))));
  const fmt = (v, j) => (v === null || v === undefined ? '' : numeric[j] && v !== '' ? Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v));
  return (
    <div className="ai-result">
      <div className="ai-result-scroll">
        <table>
          <thead><tr>{result.columns.map((c, i) => <th key={i} className={numeric[i] ? 'num' : ''}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={numeric[j] ? 'num' : ''}>{fmt(v, j)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {result.rows.length > 8 && (
        <button type="button" className="link-btn ai-result-more" onClick={() => setExpanded(e => !e)}>
          {expanded ? 'Show less' : `Show all ${Math.min(result.rows.length, 200)}${result.truncated || result.rows.length > 200 ? '+' : ''} rows`}
        </button>
      )}
    </div>
  );
}

function SqlBlock({ sql, run, onMakeTile }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ai-sql">
      <pre className="ai-sql-code"><code dangerouslySetInnerHTML={{ __html: highlightSQL(sql) }} /></pre>
      {run && run.error && <div className="ai-note is-error"><i className="ph ph-warning-circle" aria-hidden="true" /> The query didn't run: {run.error}</div>}
      {run && run.result && (run.result.rows.length ? <ResultTable result={run.result} /> : <div className="ai-note">The query ran and returned no rows.</div>)}
      <div className="ai-sql-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onMakeTile(sql)} disabled={!!(run && run.error)}>
          <i className="ph ph-chart-bar" aria-hidden="true" /> Make a tile
        </button>
        <button type="button" className="btn btn-sm ai-ghost-btn" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          <i className={`ph ${copied ? 'ph-check' : 'ph-copy'}`} aria-hidden="true" /> {copied ? 'Copied' : 'Copy SQL'}
        </button>
      </div>
    </div>
  );
}

function DraftCard({ turn, onReview, onAdd }) {
  const d = turn.draft;
  const type = CHART_TYPES.find(t => t.id === d.chartSpec.type);
  return (
    <div className="ai-draft card-feature-green">
      <div className="ai-draft-head">
        <i className={`ph ${type ? type.icon : 'ph-chart-bar'}`} aria-hidden="true" />
        <div>
          <div className="ai-draft-title">{d.chartSpec.title || 'Suggested tile'}</div>
          <div className="ai-draft-meta">{type ? type.label : 'Chart'}{d.targetTileId ? ' · updates an existing tile' : ''}</div>
        </div>
      </div>
      {turn.error && <div className="ai-note is-error"><i className="ph ph-warning-circle" aria-hidden="true" /> Its query still errors ({turn.error}). Open the preview to fix it in SQL.</div>}
      <div className="ai-draft-actions">
        <button type="button" className="btn btn-tertiary btn-sm" onClick={onReview}><i className="ph ph-sliders-horizontal" aria-hidden="true" /> Open preview</button>
        {!turn.error && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onAdd} disabled={turn.added}>
            {turn.added ? <><i className="ph ph-check" aria-hidden="true" /> Added</> : d.targetTileId ? 'Apply as is' : 'Add as is'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function AiPanel({ onCollapse, onReviewDraft, onAddDraft, onAddText, onRemoveTile }) {
  const user = useCurrentUser();
  const aiMode = useAiMode();
  const { schema } = useSchema();
  const [turns, setTurns] = useState([]); // { id, role, text, mode, reply?, error?, pending? }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const suggestions = useMemo(() => suggestionsFor(aiMode, schema), [aiMode, schema]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const patchTurn = (id, patch) => setTurns(ts => ts.map(t => (t.id === id ? { ...t, ...patch } : t)));

  const makeTileFromSql = sql => onReviewDraft({ key: Date.now(), sql, chartSpec: null, source: { mode: 'sql' }, note: 'From the assistant’s query — pick a chart type and colors, then add it.' });

  const send = async text => {
    const message = (text ?? input).trim();
    if (!message || busy) return;
    const mode = aiMode;
    const id = Date.now();
    setInput('');
    setBusy(true);
    setTurns(ts => [...ts, { id: id - 1, role: 'user', text: message, mode }, { id, role: 'assistant', mode, pending: true }]);
    try {
      const reply = await bridge.sendAiMessage(message, { mode });
      patchTurn(id, { pending: false, reply, text: reply.text });
      if (reply.kind === 'tile' && reply.draft && !reply.error) {
        onReviewDraft({ ...reply.draft, key: id });
      } else if (reply.kind === 'text' && reply.textBox) {
        const tileId = onAddText(reply.textBox);
        patchTurn(id, { addedTextId: tileId });
      }
    } catch (err) {
      patchTurn(id, { pending: false, error: err.message || String(err) });
    } finally {
      setBusy(false);
      requestAnimationFrame(() => inputRef.current && inputRef.current.focus());
    }
  };

  const clear = () => {
    setTurns([]);
    bridge.clearAiSession();
  };

  const header = (
    <header className="ai-panel-header">
      <div className="ai-panel-title">
        <i className="ph ph-sparkle" aria-hidden="true" />
        <h2>AI assistant</h2>
      </div>
      <Segmented
        size="sm"
        label="Assistant mode"
        value={aiMode}
        onChange={mode => bridge.setAiMode(mode)}
        options={[
          { id: 'ask', label: 'Ask', icon: 'ph-chat-circle-dots', disabled: !user },
          { id: 'build', label: 'Build', icon: 'ph-magic-wand', disabled: !user },
        ]}
      />
      {user && turns.length > 0 && (
        <button type="button" className="tile-icon-btn" onClick={clear} aria-label="Clear conversation" title="Clear conversation">
          <i className="ph ph-arrow-counter-clockwise" aria-hidden="true" />
        </button>
      )}
      {onCollapse && (
        <button type="button" className="tile-icon-btn" onClick={onCollapse} aria-label="Hide assistant" title="Hide assistant">
          <i className="ph ph-caret-double-right" aria-hidden="true" />
        </button>
      )}
    </header>
  );

  if (!user) {
    return (
      <aside className="ai-panel" aria-label="AI dashboard assistant">
        {header}
        <div className="ai-locked">
          <div className="ai-locked-card">
            <i className="ph ph-lock-simple" aria-hidden="true" />
            <p className="ai-locked-title">Sign in to use the AI assistant</p>
            <p className="ai-locked-body">Ask questions about your data, or describe a chart (“revenue by month, stacked by region, in blue”) and fine-tune the draft before it's added. It only ever sees column names and types, never your rows.</p>
            <div className="ai-locked-actions">
              <button type="button" className="btn btn-tertiary btn-sm" onClick={() => window.openAccountModal && window.openAccountModal('signin')}>Sign in</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.openAccountModal && window.openAccountModal('signup')}>Create a free account</button>
            </div>
          </div>
          <p className="ai-locked-foot">Building tiles by hand works without an account.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="ai-panel" aria-label="AI dashboard assistant">
      {header}
      <p className="ai-mode-hint">{MODE_HINT[aiMode]}</p>

      <div className="ai-transcript" ref={listRef} aria-live="polite">
        {turns.length === 0 ? (
          <div className="ai-empty">
            <p className="ai-empty-title">{aiMode === 'ask' ? 'Ask anything about your data' : 'What should we build?'}</p>
            <div className="ai-suggestions">
              {suggestions.map(s => (
                <button key={s} type="button" className="ai-suggestion" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : turns.map(turn => (
          turn.role === 'user' ? (
            <div key={turn.id} className="ai-msg ai-msg-user">
              <span className="ai-msg-mode">{turn.mode === 'build' ? 'Build' : 'Ask'}</span>
              {turn.text}
            </div>
          ) : (
            <div key={turn.id} className="ai-msg ai-msg-assistant">
              {turn.pending ? (
                <div className="ai-thinking"><span /><span /><span /> {turn.mode === 'build' ? 'Drafting your tile…' : 'Thinking…'}</div>
              ) : turn.error ? (
                <div className="ai-note is-error"><i className="ph ph-warning-circle" aria-hidden="true" /> {turn.error}</div>
              ) : turn.reply.mode === 'ask' ? (
                splitReply(turn.text).map((seg, i) => (seg.type === 'html'
                  ? <div key={i} className="ai-prose" dangerouslySetInnerHTML={{ __html: seg.html }} />
                  : <SqlBlock key={i} sql={seg.sql} run={turn.reply.queries[seg.index]} onMakeTile={makeTileFromSql} />))
              ) : (
                <>
                  <div className="ai-prose"><p>{turn.text}</p></div>
                  {turn.reply.kind === 'tile' && (
                    <DraftCard
                      turn={{ ...turn.reply, added: turn.added }}
                      onReview={() => onReviewDraft({ ...turn.reply.draft, key: `${turn.id}-${Date.now()}` })}
                      onAdd={() => { onAddDraft(turn.reply.draft); patchTurn(turn.id, { added: true }); }}
                    />
                  )}
                  {turn.reply.kind === 'text' && (
                    <div className="ai-draft card-feature-green">
                      <div className="ai-draft-head">
                        <i className="ph ph-text-t" aria-hidden="true" />
                        <div>
                          <div className="ai-draft-title">{turn.addedTextId ? 'Text box added' : 'Text box removed'}</div>
                          <div className="ai-draft-meta">Double-click it on the canvas to edit.</div>
                        </div>
                      </div>
                      {turn.addedTextId && (
                        <div className="ai-draft-actions">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { onRemoveTile(turn.addedTextId); patchTurn(turn.id, { addedTextId: null }); }}>Remove it</button>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        ))}
      </div>

      <form className="ai-composer" onSubmit={e => { e.preventDefault(); send(); }}>
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder={aiMode === 'ask' ? 'Ask about your data…' : 'Describe a chart, colors, a title…'}
          aria-label={aiMode === 'ask' ? 'Ask the assistant' : 'Describe what to build'}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          disabled={busy}
        />
        <button type="submit" className="ai-send" disabled={busy || !input.trim()} aria-label="Send">
          <i className="ph ph-paper-plane-right" aria-hidden="true" />
        </button>
      </form>
    </aside>
  );
}
