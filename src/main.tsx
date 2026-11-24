import React from 'react';
import ReactDOM from 'react-dom/client';
import { LandingPage } from './landing/pages/LandingPage';
import './index.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <LandingPage />
    </React.StrictMode>
  );
}
