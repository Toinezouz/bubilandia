import { describe, expect, it } from 'vitest';
import { referenceWeight, suggestNext, type ProgressionInput } from '../../src/engine/progression.ts';
import type { ExerciseKind, PerformedSet } from '../../src/engine/types.ts';

/** Builds sets: same weight, reps and RPE lists of equal length. */
function sets(weight: number | null, reps: number[], rpe: number | number[] | null): PerformedSet[] {
  return reps.map((r, i) => ({ weight, reps: r, rpe: Array.isArray(rpe) ? rpe[i]! : rpe }));
}

function input(lastSets: PerformedSet[], overrides: Partial<ProgressionInput> = {}): ProgressionInput {
  return {
    kind: 'weighted' as ExerciseKind,
    repRange: { min: 8, max: 12 },
    increment: 2.5,
    targetRPE: 8,
    lastSets,
    ...overrides,
  };
}

describe('suggestNext — weighted', () => {
  it('no history → calibration, no load', () => {
    const s = suggestNext(input([]));
    expect(s.decision).toBe('calibrate');
    expect(s.weight).toBeNull();
    expect(s.repRange).toEqual({ min: 8, max: 12 });
    expect(s.hint).toBe('Elige un peso con el que hagas ~10 reps dejando 2 en reserva.');
  });

  it('all sets at repMax with RPE ≤ 9 → +1 increment, target repMin–repMin+2', () => {
    const s = suggestNext(input(sets(40, [12, 12, 12], [8, 8.5, 9])));
    expect(s).toMatchObject({ decision: 'increase', weight: 42.5, repRange: { min: 8, max: 10 }, perSetReps: null });
  });

  it('all sets at repMax with RPE ≤ 7 → +2 increments', () => {
    const s = suggestNext(input(sets(40, [12, 12, 12], 7)));
    expect(s).toMatchObject({ decision: 'increase_double', weight: 45, repRange: { min: 8, max: 10 } });
  });

  it('reps above repMax also count as reaching it', () => {
    expect(suggestNext(input(sets(40, [13, 12, 12], 8))).decision).toBe('increase');
  });

  it('caps the new target range at repMax', () => {
    const s = suggestNext(input(sets(40, [11, 11], 8), { repRange: { min: 10, max: 11 } }));
    expect(s.repRange).toEqual({ min: 10, max: 11 });
  });

  it('in range but not all at repMax → same load, +1 rep per set (capped)', () => {
    expect(suggestNext(input(sets(40, [10, 9, 8], 8)))).toMatchObject({
      decision: 'add_rep',
      weight: 40,
      perSetReps: [11, 10, 9],
    });
    expect(suggestNext(input(sets(40, [12, 12, 11], 8))).perSetReps).toEqual([12, 12, 12]);
  });

  it('a single set below repMin is not enough to lower the load', () => {
    expect(suggestNext(input(sets(40, [9, 9, 7], 8)))).toMatchObject({ decision: 'add_rep', perSetReps: [10, 10, 8] });
  });

  it('all at repMax but RPE > 9 → keep load and reps', () => {
    expect(suggestNext(input(sets(40, [12, 12, 12], 9.5)))).toMatchObject({
      decision: 'keep',
      weight: 40,
      perSetReps: [12, 12, 12],
    });
  });

  it('≥ 2 sets under repMin → −5 % (at least one increment)', () => {
    expect(suggestNext(input(sets(40, [8, 7, 6], 9)))).toMatchObject({ decision: 'decrease', weight: 37.5 });
  });

  it('RPE ≥ 9.5 with reps under the middle of the range → −5 %', () => {
    expect(suggestNext(input(sets(40, [9, 8, 8], [9.5, 10, 10])))).toMatchObject({ decision: 'decrease', weight: 37.5 });
  });

  it('RPE ≥ 9.5 with reps above the middle → no decrease', () => {
    expect(suggestNext(input(sets(40, [11, 10, 10], 9.5))).decision).toBe('add_rep');
  });

  it('missing RPEs are treated as the target RPE', () => {
    expect(suggestNext(input(sets(40, [12, 12, 12], null))).decision).toBe('increase');
  });

  it('uses the load of most sets when it changed mid-exercise', () => {
    const last = [
      { weight: 40, reps: 12, rpe: 6 },
      { weight: 42.5, reps: 12, rpe: 8 },
      { weight: 42.5, reps: 12, rpe: 8.5 },
    ];
    expect(suggestNext(input(last))).toMatchObject({ decision: 'increase', weight: 45 });
  });

  it('weighted history without any load → calibration', () => {
    expect(suggestNext(input(sets(null, [10, 10], 8))).decision).toBe('calibrate');
  });

  it('works with 1.25 kg and 5 kg increments', () => {
    expect(suggestNext(input(sets(10, [15, 15], 8), { increment: 1.25, repRange: { min: 12, max: 15 } })).weight).toBe(11.25);
    expect(suggestNext(input(sets(80, [12, 12, 12], 8), { increment: 5 })).weight).toBe(85);
    expect(suggestNext(input(sets(80, [7, 6, 8], 9), { increment: 5 })).weight).toBe(75);
  });
});

describe('suggestNext — bodyweight', () => {
  const bw = (lastSets: PerformedSet[]) => input(lastSets, { kind: 'bodyweight' });

  it('no history → calibration in reps', () => {
    expect(suggestNext(bw([])).hint).toBe('Haz ~10 reps dejando 2 en reserva.');
  });

  it('progresses in reps first', () => {
    expect(suggestNext(bw(sets(null, [10, 9, 9], 8)))).toMatchObject({ decision: 'add_rep', weight: null, perSetReps: [11, 10, 10] });
  });

  it('beyond repMax → suggests adding load', () => {
    const s = suggestNext(bw(sets(null, [12, 13, 12], 8)));
    expect(s).toMatchObject({ decision: 'add_load', weight: 2.5, repRange: { min: 8, max: 10 } });
    expect(s.hint).toBe('Ya pasas de 12 reps: añade 2,5 kg.');
  });

  it('too hard without load → easier variant hint, no load', () => {
    const s = suggestNext(bw(sets(null, [6, 5, 5], 10)));
    expect(s).toMatchObject({ decision: 'decrease', weight: null });
    expect(s.hint).not.toBeNull();
  });

  it('with added load → behaves like a weighted exercise', () => {
    expect(suggestNext(bw(sets(5, [12, 12, 12], 8)))).toMatchObject({ decision: 'increase', weight: 7.5 });
  });
});

describe('suggestNext — timed (plancha 30-45 s, +5 s)', () => {
  const timed = (lastSets: PerformedSet[]) =>
    input(lastSets, { kind: 'timed', repRange: { min: 30, max: 45 }, increment: 5 });
  const secs = (values: number[], rpe: number) => sets(null, values, rpe);

  it('no history → calibration in seconds', () => {
    expect(suggestNext(timed([]))).toMatchObject({ decision: 'calibrate', weight: null, hint: 'Aguanta ~43 s dejando un margen.' });
  });

  it('all sets at the max with RPE ≤ 8.5 → range shifted by +5 s', () => {
    expect(suggestNext(timed(secs([45, 45, 45], 8.5)))).toMatchObject({ decision: 'extend_time', repRange: { min: 35, max: 50 } });
  });

  it('all sets at the max but RPE > 8.5 → keep', () => {
    expect(suggestNext(timed(secs([45, 45, 45], 9)))).toMatchObject({ decision: 'keep', repRange: { min: 30, max: 45 } });
  });

  it('in range → +5 s per set, capped at the max', () => {
    expect(suggestNext(timed(secs([40, 35, 35], 8)))).toMatchObject({ decision: 'add_rep', perSetReps: [45, 40, 40] });
  });

  it('keeps progress from earlier shifts', () => {
    // 50 s on every set → current range 35-50 → next 40-55.
    expect(suggestNext(timed(secs([50, 50, 50], 8))).repRange).toEqual({ min: 40, max: 55 });
    expect(suggestNext(timed(secs([55, 55, 55], 8)))).toMatchObject({ decision: 'extend_time', repRange: { min: 45, max: 60 } });
  });

  it('beyond 60 s → harder variant', () => {
    const s = suggestNext(timed(secs([60, 60, 60], 8)));
    expect(s.decision).toBe('harder_variant');
    expect(s.hint).toContain('60 s');
  });

  it('≥ 2 sets under the min → back to the base range', () => {
    expect(suggestNext(timed(secs([25, 20, 30], 9)))).toMatchObject({ decision: 'decrease', repRange: { min: 30, max: 45 } });
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
