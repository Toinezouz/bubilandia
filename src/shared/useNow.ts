import { useEffect, useState } from 'react';

/**
 * Current time for screens that show relative dates ("hoy", "hace 3 días", last 7 days…).
 * An installed iOS app is rarely reloaded: it is resumed from memory hours or days later, so
 * the time must be refreshed when the app comes back to the foreground, and while it stays
 * open (once a minute is plenty for day-level texts).
 */
export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    const timer = window.setInterval(refresh, everyMs);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('pageshow', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [everyMs]);
  return now;
}
