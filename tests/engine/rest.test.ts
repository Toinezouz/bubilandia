import { describe, expect, it } from 'vitest';
import { adjustRest, dueAlert, restView, startRest, type FiredAlerts } from '../../src/engine/rest.ts';

const T0 = 1_000_000;
const s = (seconds: number) => T0 + seconds * 1000;
const none: FiredAlerts = { warning: false, end: false };

describe('rest timer', () => {
  it('is derived from endsAt', () => {
    const rest = startRest(90, T0);
    expect(rest).toEqual({ startedAt: T0, endsAt: s(90), durationSeconds: 90 });
    expect(restView(rest, T0)).toEqual({ phase: 'running', remainingSeconds: 90, progress: 0 });
    expect(restView(rest, s(30.2))).toMatchObject({ phase: 'running', remainingSeconds: 60 });
    expect(restView(rest, s(89.5))).toMatchObject({ phase: 'running', remainingSeconds: 1 });
  });

  it('counts the time since the end once over ("terminado hace 1:20")', () => {
    const rest = startRest(90, T0);
    expect(restView(rest, s(90))).toEqual({ phase: 'ended', overtimeSeconds: 0 });
    expect(restView(rest, s(170.4))).toEqual({ phase: 'ended', overtimeSeconds: 80 });
  });

  it('gives the right value after the app was suspended (no counter)', () => {
    const rest = startRest(150, T0);
    // JS frozen in the background for 2 minutes: the next computation is simply correct.
    expect(restView(rest, s(120))).toMatchObject({ phase: 'running', remainingSeconds: 30 });
  });

  it('adjusts by ±15 s without ending in the past', () => {
    const rest = startRest(90, T0);
    expect(adjustRest(rest, 15, s(10))).toMatchObject({ endsAt: s(105), durationSeconds: 105, startedAt: T0 });
    expect(adjustRest(rest, -15, s(10))).toMatchObject({ endsAt: s(75), durationSeconds: 75 });
    expect(adjustRest(rest, -15, s(80)).endsAt).toBe(s(80)); // only 10 s left → ends now
  });
});

describe('dueAlert', () => {
  const rest = startRest(90, T0);

  it('beeps 10 s before the end, once, and only if enabled', () => {
    expect(dueAlert(rest, s(79), none, true)).toBeNull();
    expect(dueAlert(rest, s(80.1), none, true)).toBe('warning');
    expect(dueAlert(rest, s(80.1), { warning: true, end: false }, true)).toBeNull();
    expect(dueAlert(rest, s(80.1), none, false)).toBeNull();
  });

  it('fires the end alert at 0', () => {
    expect(dueAlert(rest, s(89.9), { warning: true, end: false }, true)).toBeNull();
    expect(dueAlert(rest, s(90), { warning: true, end: false }, true)).toBe('end');
    expect(dueAlert(rest, s(90.5), { warning: true, end: true }, true)).toBeNull();
  });

  it('stays silent when she comes back long after the end', () => {
    expect(dueAlert(rest, s(95), none, true)).toBeNull();
    expect(dueAlert(rest, s(85), none, true)).toBeNull(); // warning moment long gone too
  });

  it('skips the 10 s warning on rests of 10 s or less', () => {
    expect(dueAlert(startRest(10, T0), s(0.5), none, true)).toBeNull();
  });
});
