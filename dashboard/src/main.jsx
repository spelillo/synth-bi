// dashboard/src/main.jsx — mounts the dashboard canvas into #dashboard-root,
// left in the DOM by the shell's index.html. See ./bridge.js for how this
// island talks back to the shell.

import { createRoot } from 'react-dom/client';
import Dashboard from './Dashboard.jsx';
import './themes/synth.css';
import './themes/powerbi.css';
import './themes/tableau.css';

const el = document.getElementById('dashboard-root');
if (el) createRoot(el).render(<Dashboard />);
