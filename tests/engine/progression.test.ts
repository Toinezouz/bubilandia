import { describe, expect, it } from 'vitest';
import {
  entryReps,
  loadFor,
  prefillForSet,
  referenceWeight,
  repsAtTarget,
  repsFor,
  suggestNext,
  type ProgressionInput,
} from '../../src/engine/progression.ts';
import type { ExerciseKind, PerformedSet } from '../../src/engine/types.ts';

/** Sets with the same load; `rpe` is one value or one per set. */
function sets(weight: number | null, reps: number[], rpe: number | number[] | null): PerformedSet[] {
  return reps.map((r, i) => ({ weight, reps: r, rpe: Array.isArray(rpe) ? rpe[i]! : rpe }));
}

function input(lastSets: PerformedSet[], overrides: Partial<ProgressionInput> = {}): ProgressionInput {
  return {
    kind: 'weighted' as ExerciseKind,
    repRange: { min: 8, max: 12 },
    increment: 2.5,
    targetRPE: 9,
    lastSets,
    ...overrides,
  };
}

describe('capacity model', () => {
  it('reads what she could do at the target RPE', () => {
    expect(repsAtTarget({ weight: 40, reps: 12, rpe: 8 }, 9)).toBe(13); // 2 left → 1 left = one more
    expect(repsAtTarget({ weight: 40, reps: 12, rpe: 10 }, 9)).toBe(11); // to failure → one less at RPE 9
    expect(repsAtTarget({ weight: 40, reps: 12, rpe: null }, 9)).toBe(12); // no RPE: as planned
  });

  it('inverts Epley consistently', () => {
    const e1rm = 60;
    const load = loadFor(e1rm, 10, 9);
    expect(repsFor(e1rm, load, 9)).toBe(10);
    expect(entryReps({ min: 6, max: 10 })).toBe(7);
    expect(entryReps({ min: 8, max: 12 })).toBe(9);
    expect(entryReps({ min: 10, max: 15 })).toBe(11);
    expect(entryReps({ min: 12, max: 20 })).toBe(14);
  });
});

describe('suggestNext — weighted, close to failure', () => {
  it('no history → calibration aimed at the middle of the range, close to failure', () => {
    const s = suggestNext(input([]));
    expect(s).toMatchObject({ decision: 'calibrate', weight: null, repRange: { min: 8, max: 12 } });
    expect(s.hint).toBe('Primera vez: elige un peso con el que llegues a ~10 reps cerca del fallo.');
    expect(prefillForSet(s, 0)).toEqual({ weight: null, reps: 10 });
  });

  it('inside the range → same load, one more rep than her capacity at the target RPE', () => {
    // 10, 9, 8 at RPE 9 (as planned) → 11, 10, 9
    expect(suggestNext(input(sets(40, [10, 9, 8], 9)))).toMatchObject({ decision: 'add_rep', weight: 40, perSetReps: [11, 10, 9] });
    // Same reps but 2 left (RPE 8) → she could do one more at RPE 9 → +2
    expect(suggestNext(input(sets(40, [10, 9, 8], 8))).perSetReps).toEqual([12, 11, 10]);
    // To failure (RPE 10) → same reps next time (that is RPE 9 if she got stronger)
    expect(suggestNext(input(sets(40, [10, 9, 8], 10)))).toMatchObject({ decision: 'keep', perSetReps: [10, 9, 8] });
  });

  it('targets never leave the range', () => {
    const s = suggestNext(input(sets(40, [11, 10, 9], 8.5)));
    for (const r of s.perSetReps!) expect(r).toBeGreaterThanOrEqual(8), expect(r).toBeLessThanOrEqual(12);
  });

  it('top of the range reached → heavier load, even at RPE 10 (close to failure must not block progress)', () => {
    for (const rpe of [8, 9, 9.5, 10]) {
      const s = suggestNext(input(sets(40, [12, 11, 10], rpe)));
      expect(s.decision, `RPE ${rpe}`).toBe('increase');
      expect(s.weight!, `RPE ${rpe}`).toBeGreaterThan(40);
    }
  });

  it('the new load puts her back in the lower part of the range at the target RPE', () => {
    // 12 @ 9 with 40 kg → e1RM 40 × (1 + 13/30) = 57,3 → 9 reps at RPE 9 needs 42,9 → 42,5 kg
    const s = suggestNext(input(sets(40, [12, 11, 10], 9)));
    expect(s).toMatchObject({ decision: 'increase', weight: 42.5 });
    expect(s.perSetReps![0]).toBeGreaterThanOrEqual(8);
    expect(s.perSetReps![0]).toBeLessThanOrEqual(10);
    // The fatigue seen last time (−1 rep per set) is kept.
    expect(s.perSetReps).toEqual([s.perSetReps![0], s.perSetReps![0]! - 1, Math.max(8, s.perSetReps![0]! - 2)]);
  });

  it('much easier than the range → a bigger jump, capped at +12 % per session', () => {
    // 12 reps at RPE 6 (4 left): far too light.
    const s = suggestNext(input(sets(40, [12, 12, 12], 6)));
    expect(s.weight).toBe(42.5); // 40 × 1,12 = 44,8 → cap, floor to 2,5 → 42,5
    const big = suggestNext(input(sets(100, [12, 12, 12], 6), { increment: 2.5 }));
    expect(big.weight).toBe(110); // 112 capped → 110
  });

  it('bottom of the range not reachable → lighter load computed from her strength', () => {
    const s = suggestNext(input(sets(40, [6, 5, 5], 10)));
    expect(s.decision).toBe('decrease');
    expect(s.weight!).toBeLessThan(40);
    expect(s.weight!).toBeGreaterThanOrEqual(32.5); // never more than −18 %
    expect(s.perSetReps![0]).toBeGreaterThanOrEqual(8);
  });

  it('a set with reps under the range but lots of reserve is not a decrease', () => {
    // 7 reps at RPE 7: she stopped early, she could do 9 at RPE 9.
    expect(suggestNext(input(sets(40, [7, 7, 7], 7))).decision).toBe('add_rep');
  });

  it('uses the load of most sets when it changed mid-exercise', () => {
    const last = [
      { weight: 40, reps: 12, rpe: 6 },
      { weight: 42.5, reps: 10, rpe: 9 },
      { weight: 42.5, reps: 9, rpe: 9 },
    ];
    expect(suggestNext(input(last))).toMatchObject({ decision: 'add_rep', weight: 42.5, perSetReps: [11, 10] });
  });

  it('a step that is not doable yet → stays at the top of the range instead of going up and down', () => {
    // 10 kg + 1,25 kg is +12,5 %: she would fall to ~10 reps, under the 12-15 range.
    const s = suggestNext(input(sets(10, [15, 15], 9), { increment: 1.25, repRange: { min: 12, max: 15 } }));
    expect(s).toMatchObject({ decision: 'keep', weight: 10, perSetReps: [15, 15] });
  });

  it('a new load where she reaches the bottom of the range at failure is kept (no yo-yo)', () => {
    // Just after an increase: 12 reps at RPE 10 in a 12-15 range.
    const after = suggestNext(input(sets(25, [12, 11, 10], 10), { repRange: { min: 12, max: 15 } }));
    expect(after.weight).toBe(25);
    expect(after.perSetReps).toEqual([12, 12, 12]); // every set back to the bottom of the range
    // 11 reps at failure: under the range even at failure → lighter.
    expect(suggestNext(input(sets(25, [11, 10, 9], 10), { repRange: { min: 12, max: 15 } })).decision).toBe('decrease');
  });

  it('ignores sets with 0 reps; no load at all → calibration', () => {
    expect(suggestNext(input(sets(40, [0], 8))).decision).toBe('calibrate');
    expect(suggestNext(input(sets(null, [10, 10], 8))).decision).toBe('calibrate');
  });

  it('works with 1, 1,25 and 5 kg increments', () => {
    expect(suggestNext(input(sets(8, [15, 14], 9), { increment: 1, repRange: { min: 10, max: 15 } })).weight).toBe(9);
    expect(suggestNext(input(sets(20, [15, 14], 9), { increment: 1.25, repRange: { min: 12, max: 15 } })).weight).toBe(21.25);
    expect(suggestNext(input(sets(80, [12, 11, 10], 9), { increment: 5 })).weight).toBe(85);
  });
});

describe('suggestNext — bodyweight', () => {
  const bw = (lastSets: PerformedSet[]) => input(lastSets, { kind: 'bodyweight' });

  it('no history → calibration in reps', () => {
    expect(suggestNext(bw([])).hint).toBe('Primera vez: haz ~10 reps cerca del fallo.');
  });

  it('progresses in reps first', () => {
    expect(suggestNext(bw(sets(null, [10, 9, 9], 9)))).toMatchObject({ decision: 'add_rep', weight: null, perSetReps: [11, 10, 10] });
  });

  it('top of the range → suggests adding load', () => {
    const s = suggestNext(bw(sets(null, [12, 11, 10], 10)));
    expect(s).toMatchObject({ decision: 'add_load', weight: 2.5 });
    expect(s.hint).toBe('Ya llegas a 12 reps: añade 2,5 kg.');
  });

  it('too hard without load → easier variant hint', () => {
    const s = suggestNext(bw(sets(null, [5, 4, 4], 10)));
    expect(s).toMatchObject({ decision: 'decrease', weight: null });
    expect(s.hint).not.toBeNull();
  });

  it('with added load → one increment at a time', () => {
    expect(suggestNext(bw(sets(5, [12, 11, 10], 9)))).toMatchObject({ decision: 'increase', weight: 7.5 });
    expect(suggestNext(bw(sets(5, [5, 4, 4], 10)))).toMatchObject({ decision: 'decrease', weight: 2.5 });
    expect(suggestNext(bw(sets(2.5, [5, 4, 4], 10)))).toMatchObject({ decision: 'decrease', weight: null });
  });
});

describe('suggestNext — timed (plancha 30-45 s, +5 s)', () => {
  const timed = (lastSets: PerformedSet[]) => input(lastSets, { kind: 'timed', repRange: { min: 30, max: 45 }, increment: 5 });
  const secs = (values: number[], rpe: number) => sets(null, values, rpe);

  it('no history → calibration in seconds', () => {
    expect(suggestNext(timed([]))).toMatchObject({ decision: 'calibrate', hint: 'Primera vez: aguanta ~38 s cerca del fallo.' });
  });

  it('every hold at the max → range shifted by +5 s, whatever the RPE', () => {
    for (const rpe of [8, 9.5, 10]) {
      expect(suggestNext(timed(secs([45, 45, 45], rpe)))).toMatchObject({ decision: 'extend_time', repRange: { min: 35, max: 50 } });
    }
  });

  it('in range → +5 s per hold, capped at the max', () => {
    expect(suggestNext(timed(secs([40, 35, 35], 9)))).toMatchObject({ decision: 'add_rep', perSetReps: [45, 40, 40] });
  });

  it('keeps progress from earlier shifts, beyond 60 s → harder variant', () => {
    expect(suggestNext(timed(secs([50, 50, 50], 9))).repRange).toEqual({ min: 40, max: 55 });
    expect(suggestNext(timed(secs([55, 55, 55], 9)))).toMatchObject({ decision: 'extend_time', repRange: { min: 45, max: 60 } });
    expect(suggestNext(timed(secs([60, 60, 60], 9))).decision).toBe('harder_variant');
  });

  it('≥ 2 holds under the min → back to the base range', () => {
    expect(suggestNext(timed(secs([25, 20, 30], 10)))).toMatchObject({ decision: 'decrease', repRange: { min: 30, max: 45 } });
  });
});

describe('referenceWeight', () => {
  it('picks the most used load, the heavier on ties, ignoring unloaded sets', () => {
    expect(referenceWeight(sets(40, [10, 10], 8))).toBe(40);
    expect(referenceWeight([...sets(40, [10], 8), ...sets(42.5, [10], 8)])).toBe(42.5);
    expect(referenceWeight([...sets(40, [10, 10], 8), ...sets(42.5, [10], 8)])).toBe(40);
    expect(referenceWeight(sets(null, [10], 8))).toBeNull();
  });
});

describe('suggestNext — fixed reps (the program)', () => {
  const fixed = (lastSets: PerformedSet[], reps = 10, overrides: Partial<ProgressionInput> = {}) =>
    suggestNext(input(lastSets, { repRange: { min: reps, max: reps }, ...overrides }));

  it('first time → calibration on the exact number, close to failure', () => {
    const s = fixed([]);
    expect(s.hint).toBe('Primera vez: elige un peso con el que llegues a 10 reps cerca del fallo.');
    expect(prefillForSet(s, 0)).toEqual({ weight: null, reps: 10 });
  });

  it('every set asks for the same number of reps', () => {
    expect(fixed(sets(40, [10, 9, 8], 9)).perSetReps).toEqual([10, 10, 10]);
  });

  it('done at the planned effort, or one rep short → same load', () => {
    expect(fixed(sets(40, [10, 10, 9], 9))).toMatchObject({ decision: 'keep', weight: 40 });
    expect(fixed(sets(40, [10, 9, 8], 10))).toMatchObject({ decision: 'keep', weight: 40 });
    expect(fixed(sets(40, [9, 8, 7], 10))).toMatchObject({ decision: 'keep', weight: 40 }); // 1 short: try again
    expect(fixed(sets(40, [10, 10, 10], 8.5))).toMatchObject({ decision: 'keep', weight: 40 });
  });

  it('done with one more rep in reserve than planned (RPE ≤ 8), or more reps → heavier', () => {
    // 40 kg × 10 @ 8: e1RM 40 × (1 + 12/30) = 56 → 10 reps at RPE 9 needs 42 → 42,5 kg.
    expect(fixed(sets(40, [10, 10, 10], 8))).toMatchObject({ decision: 'increase', weight: 42.5, perSetReps: [10, 10, 10] });
    expect(fixed(sets(40, [12, 11, 10], 9))).toMatchObject({ decision: 'increase', weight: 42.5 });
    // Far too easy: bigger jump (e1RM 146,7 → 10 reps at RPE 9 needs 107,3 → down to 105 kg)…
    expect(fixed(sets(100, [10, 10, 10], 6))).toMatchObject({ decision: 'increase', weight: 105 });
    // …capped at +12 % (12 reps at RPE 6 would ask 116 kg → 110 kg).
    expect(fixed(sets(100, [16, 15, 14], 6))).toMatchObject({ decision: 'increase', weight: 110 });
  });

  it('a single bad session (2 reps short) repeats the load, like a coach would', () => {
    const s = fixed(sets(40, [8, 7, 6], 10));
    expect(s).toMatchObject({ decision: 'keep', weight: 40, perSetReps: [10, 10, 10] });
    expect(s.hint).toContain('repetimos el peso');
    // Previous session at this load was fine → still a bad day.
    expect(fixed(sets(40, [8, 7, 6], 10), 10, { previousSets: sets(40, [10, 9, 9], 9) }).decision).toBe('keep');
    // Previous session was at a lighter load (she just went up) → repeat once too.
    expect(fixed(sets(40, [8, 7, 6], 10), 10, { previousSets: sets(37.5, [10, 10, 9], 9) }).decision).toBe('keep');
  });

  it('a confirmed miss → lighter, at most −12 %: second short session in a row, or a clear miss', () => {
    // Two sessions in a row 2 reps short with 40 kg: e1RM 50,7 → 10 reps at RPE 9 needs 37,1 → 37,5 kg.
    expect(fixed(sets(40, [8, 7, 6], 10), 10, { previousSets: sets(40, [8, 8, 7], 10) })).toMatchObject({
      decision: 'decrease',
      weight: 37.5,
      perSetReps: [10, 10, 10],
    });
    // 4+ reps short at failure (beyond daily variation): no need to wait.
    expect(fixed(sets(100, [3, 2, 2], 10))).toMatchObject({ decision: 'decrease', weight: 87.5 });
    // 55 kg with 5 kg steps: the −12 % bound is rounded to the nearest step (50), not down (45).
    expect(fixed(sets(55, [5, 4, 4], 10), 10, { increment: 5 }).weight).toBe(50);
  });

  it('goes up only when the whole session held (the last set still reached R − 1)', () => {
    // First set easy (RPE 8) but the last one collapsed (7 reps at failure for 10 asked).
    const s = fixed(sets(40, [10, 9, 7], [8, 10, 10]));
    expect(s).toMatchObject({ decision: 'keep', weight: 40 });
    expect(s.hint).toContain('consolidamos');
    // Same first set, last set held (9 at failure) → up.
    expect(fixed(sets(40, [10, 10, 9], [8, 9, 10])).decision).toBe('increase');
  });

  it('a load step too big for now → a few extra reps with the same load, with an explanation', () => {
    // 9 kg dumbbells, 15 reps @ 8, next is 10 kg (+11 %, ~4 reps): not doable yet.
    const s = fixed(sets(9, [15, 15, 15], 8), 15, { increment: 1 });
    expect(s).toMatchObject({ decision: 'add_rep', weight: 9, perSetReps: [17, 17, 17] });
    expect(s.hint).toBe('Subir a 10 kg aún es un salto grande: haz 17 reps hasta poder subir (o usa un incremento más pequeño).');
    // Never more than 5 extra reps.
    expect(fixed(sets(9, [15, 15, 15], 6), 15, { increment: 1 }).perSetReps![0]).toBeLessThanOrEqual(20);
    // Once strong enough (18 reps @ 9 with 9 kg), the 10 kg step is taken, back to 15 reps.
    expect(fixed(sets(9, [18, 17, 16], 9), 15, { increment: 1 })).toMatchObject({ decision: 'increase', weight: 10, perSetReps: [15, 15, 15] });
  });

  it('bodyweight: one step at a time once there is reserve', () => {
    const bw = (s: PerformedSet[]) => fixed(s, 10, { kind: 'bodyweight' });
    expect(bw(sets(null, [10, 10, 10], 8))).toMatchObject({ decision: 'add_load', weight: 2.5, perSetReps: [10, 10, 10] });
    expect(bw(sets(null, [10, 9, 8], 9)).decision).toBe('keep');
    expect(bw(sets(5, [6, 5, 5], 10))).toMatchObject({ decision: 'decrease', weight: 2.5 }); // 4 short: confirmed
    expect(bw(sets(5, [7, 6, 6], 10)).decision).toBe('keep'); // 3 short once: a bad day
  });

  it('plank (40 s): held with reserve → +5 s, beyond 60 s → harder variant', () => {
    const plank = (holds: number[], rpe: number) => fixed(sets(null, holds, rpe), 40, { kind: 'timed', increment: 5 });
    expect(plank([40, 40, 40], 8)).toMatchObject({ decision: 'extend_time', repRange: { min: 45, max: 45 }, perSetReps: [45, 45, 45] });
    expect(plank([40, 40, 40], 9)).toMatchObject({ decision: 'keep', perSetReps: [40, 40, 40] });
    expect(plank([45, 45, 45], 9).perSetReps).toEqual([45, 45, 45]); // progress kept
    expect(plank([60, 60, 60], 8).decision).toBe('harder_variant');
  });
});
