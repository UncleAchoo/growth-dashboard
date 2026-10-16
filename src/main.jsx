import React from 'react';
import { createRoot } from 'react-dom/client';
import MutinyGrowthDashboard from '../mutiny_growth_dashboard.jsx';
import BetaDashboard from '../beta_dashboard.jsx';

// Default → the rebuilt dashboard (formerly ?beta, promoted Oct 16 2026).
// ?original → the previous dashboard. Old ?beta links still land on the default.
const isOriginal = new URLSearchParams(window.location.search).has('original');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isOriginal ? <MutinyGrowthDashboard /> : <BetaDashboard />}
  </React.StrictMode>
);
