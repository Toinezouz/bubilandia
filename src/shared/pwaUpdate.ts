/**
 * Service worker registration + "Nueva versión disponible" (§3).
 *
 * With registerType 'prompt' a new version waits: nothing reloads on its own. The home screen
 * shows a banner and the reload happens only when she taps "Actualizar" (never mid-workout,
 * the banner is hidden while a workout is in progress). An installed iOS app is rarely
 * reloaded, so we also look for updates when it comes back to the foreground (at most hourly).
 */

import { useSyncExternalStore } from 'react';
import { registerSW } from 'virtual:pwa-register';

const CHECK_EVERY_MS = 60 * 60 * 1000;

let updateAvailable = false;
let applyUpdate: ((reload?: boolean) => Promise<void>) | null = null;
const listeners = new Set<() => void>();

export function initPwa(): void {
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateAvailable = true;
      listeners.forEach((l) => l());
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      let lastCheck = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' || Date.now() - lastCheck < CHECK_EVERY_MS) return;
        lastCheck = Date.now();
        void registration.update();
      });
    },
  });
}

/** Activates the waiting service worker and reloads the page. */
export function installUpdate(): void {
  void applyUpdate?.(true);
}

export function usePwaUpdateAvailable(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => updateAvailable,
    () => false,
  );
}
