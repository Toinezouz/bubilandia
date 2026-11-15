import { useEffect, useState } from 'react';

export type WakeLockStatus = 'pending' | 'active' | 'unsupported';

/**
 * Keeps the screen on while `enabled` (§3): requested on mount, requested again when the app
 * comes back to the foreground (iOS drops the lock when hidden), released on unmount.
 * 'unsupported' covers both a missing API and a refused request, so the UI can show the tip.
 */
export function useWakeLock(enabled: boolean): WakeLockStatus {
  const [status, setStatus] = useState<WakeLockStatus>(
    typeof navigator !== 'undefined' && 'wakeLock' in navigator ? 'pending' : 'unsupported',
  );

  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;

    const request = async () => {
      if (document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (disposed) {
          void lock.release();
          return;
        }
        sentinel = lock;
        setStatus('active');
      } catch {
        setStatus('unsupported');
      }
    };

    const onVisibility = () => void request();
    void request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [enabled]);

  return status;
}
