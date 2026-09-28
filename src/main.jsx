import React from 'react';
import { createRoot } from 'react-dom/client';
import MutinyGrowthDashboard from '../mutiny_growth_dashboard.jsx';
import BetaDashboard from '../beta_dashboard.jsx';

// ?beta → the rebuilt dashboard (work in progress). Default stays the current one.
const isBeta = new URLSearchParams(window.location.search).has('beta');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isBeta ? <BetaDashboard /> : <MutinyGrowthDashboard />}
  </React.StrictMode>
);
