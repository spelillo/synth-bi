// dashboard/src/bridge.js — thin re-export of the shell's window.synthBridge
// (see ../../bridge.js at the project root), so island components can
// `import { bridge } from './bridge'` instead of reaching for
// `window.synthBridge` everywhere. This is the ONLY way the island talks to
// the shell — no direct sql.js/Supabase access from here. See
// BUILD-INSTRUCTIONS.md for the full shell<->island architecture.

export const bridge = window.synthBridge;
