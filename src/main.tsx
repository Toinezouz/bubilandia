import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { initPwa } from './shared/pwaUpdate.ts';
import './shared/styles/global.css';

// Service worker: offline cache + "Nueva versión disponible" banner (never reloads on its own).
initPwa();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
