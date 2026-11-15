import { describe, expect, it } from 'vitest';
import {
  adjustAfterFirstSet,
  bonusSetAllowed,
  lightSessionWeight,
  readinessLevel,
  readinessScore,
  shouldOfferLightSession,
  warmupSets,
} from '../../src/engine/session.ts';

describe('adjustAfterFirstSet (§7.5)', () => {
  const base = { kind: 'weighted' as const, increment: 2.5, repMin: 8, targetReps: 10 };

  it('much better than planned → +1 increment', () => {
    expect(adjustAfterFirstSet({ ...base, firstSet: { weight: 42.5, reps: 10, rpe: 6.5 } })).toEqual({ kind: 'increase', weight: 45 });
    expect(adjustAfterFirstSet({ ...base, firstSet: { weight: 42.5, reps: 12, rpe: 6 } })).toEqual({ kind: 'increase', weight: 45 });
  });

  it('much worse than planned → −5 %', () => {
    // RPE ≥ 9.5 and reps under target
    expect(adjustAfterFirstSet({ ...base, firstSet: { weight: 42.5, reps: 9, rpe: 9.5 } })).toEqual({ kind: 'decrease', weight: 40 });
    // reps under repMin, whatever the RPE
    expect(adjustAfterFirstSet({ ...base, firstSet: { weight: 42.5, reps: 7, rpe: 8 } })).toEqual({ kind: 'decrease', weight: 40 });
  });

  it('otherwise nothing changes', () => {
    expect(adjustAfterFirstSet({ ...base, firstSet: { weight: 42.5, reps: 10, rpe: 8 } })).toBeNull();
    expect(adjustAfterFirstSet({ ...base, firstSet: { weight: 42.5, reps: 9, rpe: 6.5 } })).toBeNull(); // easy but short of target
    expect(adjustAfterFirstSet({ ...base, firstSet: { weight: 42.5, reps: 10, rpe: 9.5 } })).toBeNull(); // hard but target met
    expect(adjustAfterFirstSet({ ...base, firstSet: { weight: 42.5, reps: 10, rpe: null } })).toBeNull();
  });

  it('does not apply to timed exercises or sets without load', () => {
    expect(adjustAfterFirstSet({ ...base, kind: 'timed', firstSet: { weight: null, reps: 20, rpe: 10 } })).toBeNull();
    expect(adjustAfterFirstSet({ ...base, kind: 'bodyweight', firstSet: { weight: null, reps: 15, rpe: 6 } })).toBeNull();
  });
});

describe('form of the day', () => {
  const s = (rpe: number | null, reps: number, targetReps = 10) => ({ rpe, reps, targetReps, targetRPE: 8 });

  it('measures the gap with the plan in reps-in-reserve units', () => {
    expect(readinessScore([s(8, 10), s(8, 10)])).toBe(0);
    expect(readinessScore([s(9.5, 9), s(9, 10)])).toBe(1.75); // (1.5 + 1 + 1) / 2
    expect(readinessScore([s(6.5, 11), s(7, 10)])).toBe(-1.75); // (−1.5 − 1 − 1) / 2
    expect(readinessScore([s(null, 10)])).toBeNull();
    expect(readinessScore([])).toBeNull();
  });

  it('turns the score into alta / normal / baja', () => {
    expect(readinessLevel(1.75)).toBe('low');
    expect(readinessLevel(1)).toBe('low');
    expect(readinessLevel(0.5)).toBe('normal');
    expect(readinessLevel(-0.9)).toBe('normal');
    expect(readinessLevel(-1)).toBe('high');
  });

  it('offers the light session once, after two exercises with a low form', () => {
    expect(shouldOfferLightSession({ exercisesMeasured: 2, readiness: 'low', alreadyOffered: false })).toBe(true);
    expect(shouldOfferLightSession({ exercisesMeasured: 1, readiness: 'low', alreadyOffered: false })).toBe(false);
    expect(shouldOfferLightSession({ exercisesMeasured: 2, readiness: 'normal', alreadyOffered: false })).toBe(false);
    expect(shouldOfferLightSession({ exercisesMeasured: 3, readiness: 'low', alreadyOffered: true })).toBe(false);
  });

  it('light session removes ~10 % (at least one increment)', () => {
    expect(lightSessionWeight(50, 2.5)).toBe(45);
    expect(lightSessionWeight(10, 1)).toBe(9);
    expect(lightSessionWeight(5, 5)).toBe(5); // already the minimum
  });
});

describe('bonusSetAllowed', () => {
  it('only after an RPE ≤ 8 and when the form is not low', () => {
    expect(bonusSetAllowed({ lastSetRpe: 8, readiness: 'normal', lightSession: false })).toBe(true);
    expect(bonusSetAllowed({ lastSetRpe: 7, readiness: null, lightSession: false })).toBe(true);
    expect(bonusSetAllowed({ lastSetRpe: 8.5, readiness: 'high', lightSession: false })).toBe(false);
    expect(bonusSetAllowed({ lastSetRpe: 7, readiness: 'low', lightSession: false })).toBe(false);
    expect(bonusSetAllowed({ lastSetRpe: 7, readiness: 'normal', lightSession: true })).toBe(false);
    expect(bonusSetAllowed({ lastSetRpe: null, readiness: 'normal', lightSession: false })).toBe(false);
  });
});

describe('warmupSets', () => {
  it('~50 % × 10 then ~70 % × 5, rounded to the increment', () => {
    expect(warmupSets(60, 2.5)).toEqual([
      { weight: 30, reps: 10 },
      { weight: 42.5, reps: 5 }, // 42 → 42.5
    ]);
    expect(warmupSets(100, 5)).toEqual([
      { weight: 50, reps: 10 },
      { weight: 70, reps: 5 },
    ]);
  });

  it('drops sets that would not be lighter, and needs a working load', () => {
    expect(warmupSets(5, 2.5)).toEqual([{ weight: 2.5, reps: 10 }]); // 3,5 → 2,5 duplicate dropped
    expect(warmupSets(2.5, 2.5)).toEqual([]);
    expect(warmupSets(null, 2.5)).toEqual([]);
  });
});
