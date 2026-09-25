// dashboard/src/main.jsx — mounts the dashboard canvas into #dashboard-root,
// left in the DOM by the shell's index.html. See ./bridge.js for how this
// island talks back to the shell.
//
// tokens.css is loaded by index.html itself; the island only brings its own
// structural styles (dashboard.css) plus the preview-mode theme layers.

import { createRoot } from 'react-dom/client';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import Dashboard from './Dashboard.jsx';
import { renderDashboardPng } from './lib/dashboardImage.js';
import './dashboard.css';
import './themes/synth.css';
import './themes/powerbi.css';
import './themes/tableau.css';

const el = document.getElementById('dashboard-root');
if (el && window.synthBridge) {
  createRoot(el).render(<Dashboard />);
  // Saved-dashboard thumbnails: a small PNG of the canvas as it looks now,
  // or null when the canvas isn't on screen to measure (another tab open).
  window.synthBridge.setThumbnailRenderer(async () => {
    const grid = document.querySelector('.dash-grid') || document.querySelector('.dash-stack');
    if (!grid || !grid.getBoundingClientRect().width) return null;
    const bg = getComputedStyle(document.querySelector('.dash')).backgroundColor;
    return renderDashboardPng(grid, { background: bg, scale: 0.35, padding: 16 });
  });
}
