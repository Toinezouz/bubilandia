/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves the app from /<repo-name>/ : the deploy workflow sets BASE_PATH.
// Locally (and on Netlify) the app lives at the root.
const base = process.env.BASE_PATH ?? '/';

const THEME_COLOR = '#0f1115';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt': never reload on our own (could happen mid-workout). Phase 2 adds the
      // "Nueva versión disponible – Actualizar" banner on top of this.
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Bubilandia fuerza',
        short_name: 'Bubilandia',
        description: 'Tu cuaderno de entrenamiento: series, RPE y progresión automática.',
        lang: 'es',
        dir: 'ltr',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: THEME_COLOR,
        theme_color: THEME_COLOR,
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Offline first: every built asset is precached, SPA navigations fall back to index.html.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest,woff2}'],
        // Launch screens are read by iOS when the app is installed, never by the app itself.
        globIgnores: ['**/splash/**'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        // Keep the service worker off in dev to avoid stale-cache confusion; test it with `npm run preview`.
        enabled: false,
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
