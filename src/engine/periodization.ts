/**
 * Long-term adjustments (§7.6): stagnation, deload week, return after a break.
 * Dates are epoch ms; sessions are completed workouts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const EPSILON = 0.01;

// ─── Stagnation ─────────────────────────────────────────────────────────────────

export const STAGNATION_SESSIONS = 3;

/**
 * True when the best e1RM of each of the last 3 sessions did not beat the best e1RM reached
 * before them. `e1rms`: one value per session, oldest first, deload sessions excluded.
 */
export function isStagnating(e1rms: ReadonlyArray<number>): boolean {
  if (e1rms.length < STAGNATION_SESSIONS + 1) return false;
  const before = Math.max(...e1rms.slice(0, -STAGNATION_SESSIONS));
  return e1rms.slice(-STAGNATION_SESSIONS).every((v) => v <= before + EPSILON);
}

export const STAGNATION_ADVICE =
  'Sin mejorar en 3 sesiones: prueba bajar un 10 % y volver a subir poco a poco, o cambia a una alternativa durante unas semanas.';

// ─── Deload ─────────────────────────────────────────────────────────────────────

export const DELOAD_SESSIONS = 4;
export const DELOAD_AFTER_WEEKS = 6;
export const BREAK_DAYS = 10;
/** "Ahora no" on the deload proposal: asked again after a week. */
export const DELOAD_SNOOZE_DAYS = 7;

export interface SessionInfo {
  /** Start of the session (epoch ms). */
  at: number;
  readiness: 'high' | 'normal' | 'low' | null;
  isDeload: boolean;
}

export type DeloadReason = 'fatigue' | 'duration';

/**
 * Start of the current block of continuous training: the first session after the last
 * deload session or after the last break of ≥ 10 days. Null without sessions.
 */
export function trainingBlockStart(sessions: ReadonlyArray<SessionInfo>): number | null {
  const sorted = [...sessions].sort((a, b) => a.at - b.at);
  if (sorted.length === 0) return null;
  let start = sorted[0]!.at;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    if (prev.isDeload || sorted[i]!.at - prev.at >= BREAK_DAYS * DAY_MS) start = sorted[i]!.at;
  }
  if (sorted.at(-1)!.isDeload) return null; // a deload just ended: the new block has not started
  return start;
}

/**
 * Proposes a deload week (§7.6) when:
 * - fatigue: "baja" in at least half of the sessions of the last 2 weeks (≥ 2 measured), or
 * - duration: 6 weeks or more of continuous training.
 * Nothing during a deload, right after one, after a break, or while snoozed.
 */
export function deloadRecommendation(input: {
  sessions: ReadonlyArray<SessionInfo>;
  now: number;
  deloadInProgress: boolean;
  snoozedAt: number | null;
}): DeloadReason | null {
  const { sessions, now, deloadInProgress, snoozedAt } = input;
  if (deloadInProgress) return null;
  if (snoozedAt !== null && now - snoozedAt < DELOAD_SNOOZE_DAYS * DAY_MS) return null;
  const last = [...sessions].sort((a, b) => b.at - a.at)[0];
  if (!last || now - last.at >= BREAK_DAYS * DAY_MS) return null; // coming back from a break: no deload

  const recent = sessions.filter((s) => !s.isDeload && now - s.at <= 14 * DAY_MS && s.readiness !== null);
  const low = recent.filter((s) => s.readiness === 'low').length;
  if (recent.length >= 2 && low * 2 >= recent.length) return 'fatigue';

  const start = trainingBlockStart(sessions);
  if (start !== null && now - start >= DELOAD_AFTER_WEEKS * 7 * DAY_MS) return 'duration';
  return null;
}

/** Deload session: one set less per exercise (at least one). Loads −10 % (see lightSessionWeight). */
export function deloadSets(baseSets: number): number {
  return Math.max(1, baseSets - 1);
}

// ─── Return after a break ───────────────────────────────────────────────────────

/**
 * ≥ 10 days without training → −10 % proposed on the first session of each type after the
 * break. True when the most recent break of ≥ 10 days happened after this session type was
 * last done (its last session is before the break).
 * @param allSessions start times of every completed session
 * @param templateLastAt last completed session of this type, null if never done (no history: nothing to lower)
 */
export function returnFromBreak(allSessions: ReadonlyArray<number>, templateLastAt: number | null, now: number): boolean {
  if (templateLastAt === null) return false;
  const times = [...allSessions].sort((a, b) => a - b);
  times.push(now);
  // Find the most recent gap of ≥ 10 days and the moment it started.
  let breakStart: number | null = null;
  for (let i = times.length - 1; i > 0; i--) {
    if (times[i]! - times[i - 1]! >= BREAK_DAYS * DAY_MS) {
      breakStart = times[i - 1]!;
      break;
    }
  }
  return breakStart !== null && templateLastAt <= breakStart;
}

export function daysSince(at: number, now: number): number {
  return Math.floor((now - at) / DAY_MS);
}
