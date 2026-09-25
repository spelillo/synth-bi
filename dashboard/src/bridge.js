// dashboard/src/bridge.js — thin re-export of the shell's window.synthBridge
// (see ../../bridge.js at the project root), so island components can
// `import { bridge } from './bridge'` instead of reaching for
// `window.synthBridge` everywhere. This is the ONLY way the island talks to
// the shell — no direct sql.js/Supabase access from here. See
// BUILD-INSTRUCTIONS.md for the full shell<->island architecture.
//
// The hooks below turn the bridge's on*() subscriptions into React state,
// so a change made anywhere in the shell (a file added, a table renamed, a
// sign-in, tiles restored from a saved workspace) re-renders the island.

import { useEffect, useState } from 'react';

export const bridge = window.synthBridge;

export function useSchema() {
  const [state, setState] = useState(() => ({ schema: bridge.getSchema(), version: bridge.getSchemaVersion() }));
  useEffect(() => bridge.onSchemaChange(schema => setState({ schema, version: bridge.getSchemaVersion() })), []);
  return state;
}

export function useTiles() {
  const [tiles, setTiles] = useState(() => bridge.getTiles());
  useEffect(() => bridge.onTilesChange(next => setTiles(next)), []);
  return tiles;
}

export function useCurrentUser() {
  const [user, setUser] = useState(() => bridge.getCurrentUser());
  useEffect(() => bridge.onAuthChange(() => setUser(bridge.getCurrentUser())), []);
  return user;
}

export function useAiMode() {
  const [mode, setMode] = useState(() => bridge.getAiMode());
  useEffect(() => bridge.onAiModeChange(next => setMode(next)), []);
  return mode;
}
