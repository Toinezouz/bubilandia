import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App.tsx';
import './shared/styles/global.css';

// Registers the service worker (precache → offline). With registerType 'prompt' the new
// version waits until the user accepts it; the update banner itself comes in phase 2.
registerSW({ immediate: true });

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
