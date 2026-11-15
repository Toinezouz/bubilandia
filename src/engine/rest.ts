/**
 * Rest timer (§6.3). The timer is never a counter: it is fully derived from `endsAt`, so it
 * stays right after the JS was suspended in the background, a reload or an app kill.
 */

export interface RestTimer {
  /** When the rest started (epoch ms); identifies one rest period. */
  startedAt: number;
  /** When the rest ends (epoch ms). */
  endsAt: number;
  /** Planned duration, adjusted by ±15 s; used for the progress bar. */
  durationSeconds: number;
}

export type RestView =
  | { phase: 'running'; remainingSeconds: number; progress: number }
  | { phase: 'ended'; overtimeSeconds: number };

export function startRest(durationSeconds: number, now: number): RestTimer {
  return { startedAt: now, endsAt: now + durationSeconds * 1000, durationSeconds };
}

/** Rounded up while running ("0:01" until it is really over), counted up once ended. */
export function restView(rest: RestTimer, now: number): RestView {
  const remainingMs = rest.endsAt - now;
  if (remainingMs > 0) {
    const total = Math.max(1, rest.durationSeconds * 1000);
    return {
      phase: 'running',
      remainingSeconds: Math.ceil(remainingMs / 1000),
      progress: Math.min(1, Math.max(0, 1 - remainingMs / total)),
    };
  }
  return { phase: 'ended', overtimeSeconds: Math.floor((now - rest.endsAt) / 1000) };
}

/** −15 s / +15 s. Never ends in the past: a big "−" simply ends the rest now. */
export function adjustRest(rest: RestTimer, deltaSeconds: number, now: number): RestTimer {
  const endsAt = Math.max(now, rest.endsAt + deltaSeconds * 1000);
  return { ...rest, endsAt, durationSeconds: Math.max(0, rest.durationSeconds + deltaSeconds) };
}

export const WARNING_SECONDS = 10;
/**
 * An alert only fires if its moment passed less than this long ago: coming back to the app
 * 3 minutes after the end must not beep (the UI shows "Descanso terminado hace 3:00" instead).
 */
export const ALERT_WINDOW_MS = 1500;

export interface FiredAlerts {
  warning: boolean;
  end: boolean;
}

/** Which alert is due now, if any. The caller records it in `fired` so each fires once. */
export function dueAlert(
  rest: RestTimer,
  now: number,
  fired: FiredAlerts,
  warningEnabled: boolean,
): 'warning' | 'end' | null {
  const remainingMs = rest.endsAt - now;
  if (!fired.end && remainingMs <= 0 && remainingMs > -ALERT_WINDOW_MS) return 'end';
  const warningMs = WARNING_SECONDS * 1000;
  if (
    warningEnabled &&
    !fired.warning &&
    rest.durationSeconds > WARNING_SECONDS &&
    remainingMs <= warningMs &&
    remainingMs > warningMs - ALERT_WINDOW_MS
  ) {
    return 'warning';
  }
  return null;
}
