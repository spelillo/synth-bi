// scripts/build-public.mjs — assembles the deployable static site into
// public/ (Vercel's output directory; api/ stays at the root as functions).
// Copies exactly what the browser loads — the shell's HTML/CSS/JS,
// excel_chart.py, shared/, vendor/, and the built island — so node_modules,
// dashboard/src, design docs, and Supabase config are never served.
// Local development still works straight from the repo root.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public');
const EXTS = /\.(html|css|js|py|ico|png|svg|txt|xml)$/i;
const SKIP_FILES = new Set(['package.json', 'package-lock.json', 'vercel.json']);
const DIRS = ['shared', 'vendor', 'dashboard-dist'];

if (!existsSync(join(root, 'dashboard-dist', 'dashboard.js'))) {
  console.error('dashboard-dist/ is missing — run the dashboard build first.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
let count = 0;
for (const name of readdirSync(root)) {
  const src = join(root, name);
  if (statSync(src).isFile() && EXTS.test(name) && !SKIP_FILES.has(name)) {
    cpSync(src, join(out, name));
    count++;
  }
}
for (const dir of DIRS) {
  cpSync(join(root, dir), join(out, dir), { recursive: true, filter: src => !src.endsWith('.md') });
  count++;
}
console.log(`public/ ready: ${count} entries`);
