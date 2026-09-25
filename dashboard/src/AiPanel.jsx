// dashboard/src/AiPanel.jsx — the AI assistant panel living alongside the
// dashboard canvas (replaces synth-sql's separate "Query & Chat" tab — see
// initial-build.md §9). Hosts the Ask/Agent mode toggle (§6):
//
//   - Ask Mode (v1): proposes a query + chart spec in chat; "Add to
//     dashboard" calls bridge.js's setTiles() to place it.
//   - Agent Mode (v1.1, not in the first build): acts on the dashboard
//     directly via a Groq tool-calling loop, narrating changes as it makes
//     them (act-freely-with-undo, per §6's decision).
//
// Disabled entirely in Lite Mode (no sign-in) — see bridge.js's
// getCurrentUser()/requireSignIn().

import { bridge, useAiMode, useCurrentUser } from './bridge.js';
import Segmented from './Segmented.jsx';

export default function AiPanel({ onCollapse }) {
  const user = useCurrentUser();
  const aiMode = useAiMode();

  return (
    <aside className="ai-panel" aria-label="AI dashboard assistant">
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
            { id: 'ask', label: 'Ask', disabled: !user },
            { id: 'agent', label: 'Agent', disabled: true, title: 'Agent Mode is coming soon: the assistant will build tiles for you directly.' },
          ]}
        />
        {onCollapse && (
          <button type="button" className="tile-icon-btn" onClick={onCollapse} aria-label="Hide assistant" title="Hide assistant">
            <i className="ph ph-caret-double-right" aria-hidden="true" />
          </button>
        )}
      </header>

      {!user ? (
        <div className="ai-locked">
          <div className="ai-locked-card">
            <i className="ph ph-lock-simple" aria-hidden="true" />
            <p className="ai-locked-title">Sign in to use the AI assistant</p>
            <p className="ai-locked-body">Ask for a chart in plain English (“revenue by month”) and add it to the dashboard in one click. It only ever sees column names and types, never your rows.</p>
            <div className="ai-locked-actions">
              <button type="button" className="btn btn-tertiary btn-sm" onClick={() => window.openAccountModal && window.openAccountModal('signin')}>Sign in</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.openAccountModal && window.openAccountModal('signup')}>Create a free account</button>
            </div>
          </div>
          <p className="ai-locked-foot">Building tiles by hand works without an account.</p>
        </div>
      ) : (
        <div className="ai-locked">
          <p className="ai-locked-foot">The assistant is being wired up in the next build step.</p>
        </div>
      )}
    </aside>
  );
}
