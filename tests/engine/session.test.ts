import { describe, expect, it } from 'vitest';
import {
  adjustAfterFirstSet,
  adjustAfterLaterSet,
  bonusSetAllowed,
  lightSessionWeight,
  performanceIndex,
  readinessLevel,
  readinessScore,
  shouldOfferLightSession,
  warmupSets,
} from '../../src/engine/session.ts';

describe('adjustAfterFirstSet (§7.5)', () => {
  // 8-12 range, target RPE 9, first set planned for 10 reps, next for 9.
  const base = { kind: 'weighted' as const, increment: 2.5, repMin: 8, repMax: 12, targetRPE: 9, targetReps: 10, nextTargetReps: 9 };

  it('2+ reps better than planned (at the target RPE) → heavier load computed from today', () => {
    // 10 reps with 3 left (RPE 7) = 12 at RPE 9: e1RM 60,9 → 9 reps at RPE 9 needs 45,7 → 45 kg.
    expect(adjustAfterFirstSet({ ...base, firstSet: { weight: 42.5, reps: 10, rpe: 7 } })).toEqual({ kind: 'increase', weight: 45, reps: 9 });
  });

  it('2+ reps worse than planned, or under the range → lighter load computed from today', () => {
    // 8 reps at failure = 7 at RPE 9 (3 short): e1RM 53,8 → 9 reps at RPE 9 needs 40,4 → 40 kg.
    expect(adjustAfterFirstSet({ ...base, firstSet: { weight: 42.5, reps: 8, rpe: 10 } })).toEqual({ kind: 'decrease', weight: 40, reps: 9 });
    expect(adjustAfterFirstSet({ ...base, firstSet: { weight: 42.5, reps: 7, rpe: 8 } })?.kind).toBe('decrease');
  });

  it('within a rep of the plan → nothing changes (close to failure is the plan)', () => {
    for (const set of [
      { weight: 42.5, reps: 10, rpe: 9 },
      { weight: 42.5, reps: 11, rpe: 9 },
      { weight: 42.5, reps: 9, rpe: 9 },
      { weight: 42.5, reps: 10, rpe: 10 },
      { weight: 42.5, reps: 10, rpe: null },
    ]) {
      expect(adjustAfterFirstSet({ ...base, firstSet: set }), JSON.stringify(set)).toBeNull();
    }
  });

  it('first session (calibration load too light) → proposes at least one increment, even on light loads', () => {
    // 10 reps at RPE 6 with 20 kg: 4 reps better than planned; +12 % of 20 kg is < 2,5 kg.
    expect(adjustAfterFirstSet({ ...base, firstSet: { weight: 20, reps: 10, rpe: 6 } })).toMatchObject({ kind: 'increase', weight: 22.5 });
  });

  it('never more than ±12 % (one increment always allowed)', () => {
    const big = adjustAfterFirstSet({ ...base, firstSet: { weight: 100, reps: 12, rpe: 6 } });
    expect(big).toMatchObject({ kind: 'increase', weight: 110 }); // 112 → floor 110
    const low = adjustAfterFirstSet({ ...base, firstSet: { weight: 100, reps: 3, rpe: 10 } });
    expect(low).toMatchObject({ kind: 'decrease', weight: 87.5 }); // 88 → floor 87,5
  });

  it('does not apply to timed or bodyweight exercises, or sets without load', () => {
    expect(adjustAfterFirstSet({ ...base, kind: 'timed', firstSet: { weight: null, reps: 20, rpe: 10 } })).toBeNull();
    expect(adjustAfterFirstSet({ ...base, kind: 'bodyweight', firstSet: { weight: null, reps: 15, rpe: 6 } })).toBeNull();
    expect(adjustAfterFirstSet({ ...base, firstSet: { weight: null, reps: 15, rpe: 6 } })).toBeNull();
  });
});

describe('form of the day', () => {
  const sets = (weight: number | null, reps: number[], rpe: number) => reps.map((r) => ({ weight, reps: r, rpe }));
  /** Form after doing `today` when the last session was `last`. */
  const form = (last: ReturnType<typeof sets>, today: ReturnType<typeof sets>, kind: 'weighted' | 'bodyweight' = 'weighted') =>
    readinessLevel(readinessScore([{ today: performanceIndex(kind, today)!, reference: performanceIndex(kind, last)! }])!);

  it('repeating the last session is a normal day (not "baja")', () => {
    const last = sets(50, [10, 9, 8], 8);
    expect(form(last, sets(50, [10, 9, 8], 8))).toBe('normal');
    expect(form(last, sets(50, [10], 8))).toBe('normal'); // same first set, rest not done yet
    expect(form(last, sets(50, [9], 8))).toBe('normal'); // one rep less: within the noise
    expect(form(last, sets(50, [10], 9))).toBe('normal'); // one RPE point harder: within the noise
  });

  it('clearly weaker → baja, clearly stronger → alta', () => {
    const last = sets(50, [10, 9, 8], 8);
    expect(form(last, sets(50, [9], 9.5))).toBe('low'); // one rep less and much harder
    expect(form(last, sets(50, [7], 10))).toBe('low');
    expect(form(last, sets(50, [11], 7))).toBe('high'); // one rep more and easier
    expect(form(last, sets(52.5, [10], 8))).toBe('high'); // heavier, same reps and RPE
  });

  it('is independent of the load chosen today', () => {
    // 47,5 × 11 @ 8 (e1RM 68,1) is about as strong as 50 × 10 @ 8 (e1RM 70): choosing a
    // slightly lighter load for one more rep is not a bad day.
    expect(form(sets(50, [10], 8), sets(47.5, [11], 8))).toBe('normal');
  });

  it('works without load (bodyweight) from reps and reserve', () => {
    expect(form(sets(null, [12], 8), sets(null, [12], 8), 'bodyweight')).toBe('normal');
    expect(form(sets(null, [12], 8), sets(null, [9], 9.5), 'bodyweight')).toBe('low');
  });

  it('averages the exercises and needs data', () => {
    expect(readinessScore([{ today: 95, reference: 100 }, { today: 105, reference: 100 }])).toBeCloseTo(0, 10);
    expect(readinessScore([])).toBeNull();
    expect(performanceIndex('timed', [{ weight: null, reps: 45, rpe: 8 }])).toBeNull();
    expect(performanceIndex('weighted', [{ weight: null, reps: 10, rpe: 8 }])).toBeNull();
    expect(performanceIndex('weighted', [{ weight: 50, reps: 10, rpe: null }])).toBeNull();
  });

  it('turns the score into alta / normal / baja at ±4 %', () => {
    expect(readinessLevel(-0.05)).toBe('low');
    expect(readinessLevel(-0.04)).toBe('low');
    expect(readinessLevel(-0.03)).toBe('normal');
    expect(readinessLevel(0.03)).toBe('normal');
    expect(readinessLevel(0.04)).toBe('high');
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
  const base = { lastSetRpe: 9, lastSetReps: 10, repMin: 10, targetRPE: 9, readiness: 'normal' as const, lightSession: false };

  it('offered when the last set was not harder than planned, inside the range', () => {
    expect(bonusSetAllowed(base)).toBe(true);
    expect(bonusSetAllowed({ ...base, lastSetRpe: 8, readiness: null })).toBe(true);
  });

  it('hidden after a grinding set, under the range, on a low day or a light session', () => {
    expect(bonusSetAllowed({ ...base, lastSetRpe: 9.5 })).toBe(false);
    expect(bonusSetAllowed({ ...base, lastSetReps: 9 })).toBe(true); // one rep less: normal fatigue
    expect(bonusSetAllowed({ ...base, lastSetReps: 8 })).toBe(false);
    expect(bonusSetAllowed({ ...base, readiness: 'low' })).toBe(false);
    expect(bonusSetAllowed({ ...base, lightSession: true })).toBe(false);
    expect(bonusSetAllowed({ ...base, lastSetRpe: null })).toBe(false);
  });

  it('follows her target: training to failure (target 10) still allows the bonus set', () => {
    expect(bonusSetAllowed({ ...base, lastSetRpe: 10, targetRPE: 10 })).toBe(true);
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

describe('adjustAfterLaterSet (fatigue between sets)', () => {
  const base = { kind: 'weighted' as const, increment: 2.5, targetRPE: 9, nextTargetReps: 10 };

  it('a later set 2+ reps short even at failure → lighter for the next set', () => {
    // 40 kg × 8 @ 10 → e1RM 50,7 → 10 reps at RPE 9 needs 37,1 → 37,5 kg.
    expect(adjustAfterLaterSet({ ...base, set: { weight: 40, reps: 8, rpe: 10 } })).toEqual({ kind: 'decrease', weight: 37.5, reps: 10 });
    // Never more than −12 %.
    expect(adjustAfterLaterSet({ ...base, set: { weight: 100, reps: 3, rpe: 10 } })?.weight).toBe(87.5);
  });

  it('normal fatigue (one rep short, or the planned effort) → nothing; never heavier', () => {
    expect(adjustAfterLaterSet({ ...base, set: { weight: 40, reps: 9, rpe: 10 } })).toBeNull();
    expect(adjustAfterLaterSet({ ...base, set: { weight: 40, reps: 10, rpe: 9 } })).toBeNull();
    expect(adjustAfterLaterSet({ ...base, set: { weight: 40, reps: 10, rpe: 6 } })).toBeNull();
    expect(adjustAfterLaterSet({ ...base, kind: 'bodyweight', set: { weight: null, reps: 5, rpe: 10 } })).toBeNull();
  });
});
