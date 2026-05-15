import React from 'react';
import { createRoot } from 'react-dom/client';
import MutinyGrowthDashboard from '../mutiny_growth_dashboard.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MutinyGrowthDashboard />
  </React.StrictMode>
);
