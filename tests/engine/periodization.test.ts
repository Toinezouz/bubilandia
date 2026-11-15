import { describe, expect, it } from 'vitest';
import {
  deloadRecommendation,
  deloadSets,
  isStagnating,
  returnFromBreak,
  trainingBlockStart,
  type SessionInfo,
} from '../../src/engine/periodization.ts';

const DAY = 24 * 3_600_000;
const T0 = new Date(2026, 0, 5, 18).getTime();
const at = (day: number) => T0 + day * DAY;

describe('isStagnating', () => {
  it('needs 3 sessions without beating the previous best', () => {
    expect(isStagnating([50, 52, 51, 52, 51.5])).toBe(true); // best 52 before, then 51, 52, 51.5
    expect(isStagnating([50, 52, 51, 52.5, 51])).toBe(false); // 52.5 is a new best
    expect(isStagnating([50, 51, 52, 53])).toBe(false);
  });

  it('needs enough history', () => {
    expect(isStagnating([50, 50, 50])).toBe(false);
    expect(isStagnating([])).toBe(false);
  });
});

describe('trainingBlockStart', () => {
  const s = (day: number, extra: Partial<SessionInfo> = {}): SessionInfo => ({ at: at(day), readiness: 'normal', isDeload: false, ...extra });

  it('starts after the last break of 10+ days or the last deload', () => {
    expect(trainingBlockStart([s(0), s(2), s(4)])).toBe(at(0));
    expect(trainingBlockStart([s(0), s(2), s(15), s(17)])).toBe(at(15));
    expect(trainingBlockStart([s(0), s(2, { isDeload: true }), s(4)])).toBe(at(4));
    expect(trainingBlockStart([])).toBeNull();
  });
});

describe('deloadRecommendation', () => {
  const s = (day: number, readiness: SessionInfo['readiness'] = 'normal', isDeload = false): SessionInfo => ({ at: at(day), readiness, isDeload });
  const base = { deloadInProgress: false, snoozedAt: null };

  it('after 6 weeks of continuous training', () => {
    const sessions = Array.from({ length: 22 }, (_, i) => s(i * 2)); // every 2 days, up to day 42
    expect(deloadRecommendation({ ...base, sessions, now: at(42) })).toBe('duration');
    expect(deloadRecommendation({ ...base, sessions: sessions.slice(0, 20), now: at(39) })).toBeNull();
  });

  it('when the form was low in at least half of the sessions of the last 2 weeks', () => {
    const sessions = [s(0, 'low'), s(2, 'normal'), s(5, 'low'), s(7, 'high')];
    expect(deloadRecommendation({ ...base, sessions, now: at(8) })).toBe('fatigue');
    expect(deloadRecommendation({ ...base, sessions: [s(0, 'low'), s(2), s(5), s(7)], now: at(8) })).toBeNull();
    expect(deloadRecommendation({ ...base, sessions: [s(7, 'low')], now: at(8) })).toBeNull(); // one session is not enough
  });

  it('never during a deload, while snoozed, or when coming back from a break', () => {
    const sessions = Array.from({ length: 22 }, (_, i) => s(i * 2));
    expect(deloadRecommendation({ ...base, sessions, now: at(42), deloadInProgress: true })).toBeNull();
    expect(deloadRecommendation({ ...base, sessions, now: at(42), snoozedAt: at(40) })).toBeNull();
    expect(deloadRecommendation({ ...base, sessions, now: at(50), snoozedAt: at(40) })).toBe('duration'); // snooze (7 days) over
    expect(deloadRecommendation({ ...base, sessions, now: at(53) })).toBeNull(); // last session 11 days ago: a break
  });

  it('removes one set per exercise', () => {
    expect(deloadSets(3)).toBe(2);
    expect(deloadSets(2)).toBe(1);
    expect(deloadSets(1)).toBe(1);
  });
});

describe('returnFromBreak', () => {
  it('lowers the first session of each type after 10+ days off', () => {
    const sessions = [at(0), at(2), at(4), at(6)];
    // 12 days without training, Pierna A last done on day 4.
    expect(returnFromBreak(sessions, at(4), at(18))).toBe(true);
  });

  it('only the first session of that type after the break', () => {
    // Back on day 18 (some type), Pierna A done again on day 20 → next Pierna A is normal.
    const sessions = [at(0), at(4), at(18), at(20)];
    expect(returnFromBreak(sessions, at(20), at(23))).toBe(false);
    // …but a type not done since before the break is still lowered.
    expect(returnFromBreak(sessions, at(0), at(23))).toBe(true);
  });

  it('nothing without a break or without history', () => {
    expect(returnFromBreak([at(0), at(3), at(6)], at(3), at(9))).toBe(false);
    expect(returnFromBreak([at(0)], null, at(30))).toBe(false);
  });
});
