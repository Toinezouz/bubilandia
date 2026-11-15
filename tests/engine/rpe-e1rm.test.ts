import { describe, expect, it } from 'vitest';
import { bestE1RM, estimateE1RM } from '../../src/engine/e1rm.ts';
import { RPE_LABELS, RPE_VALUES, averageRpe, rir } from '../../src/engine/rpe.ts';

describe('RPE scale', () => {
  it('labels every RPE value once', () => {
    expect(RPE_LABELS.map((l) => l.rpe).sort((a, b) => a - b)).toEqual([...RPE_VALUES]);
  });

  it('converts RPE to reps in reserve', () => {
    expect(rir(10)).toBe(0);
    expect(rir(8)).toBe(2);
    expect(rir(7.5)).toBe(2.5);
  });

  it('averages known RPEs and falls back when none is known', () => {
    expect(averageRpe([8, null, 9], 8)).toBe(8.5);
    expect(averageRpe([null, null], 8)).toBe(8);
    expect(averageRpe([], 7)).toBe(7);
  });
});

describe('e1RM', () => {
  it('applies Epley on reps + reps in reserve', () => {
    expect(estimateE1RM(100, 5, 10)).toBeCloseTo(116.667, 3);
    expect(estimateE1RM(100, 5, 8)).toBeCloseTo(123.333, 3); // 5 + 2 in reserve
    expect(estimateE1RM(40, 10, 9.5)).toBeCloseTo(54, 6); // 10.5 effective reps
  });

  it('treats a missing RPE as RPE 10', () => {
    expect(estimateE1RM(100, 5, null)).toBe(estimateE1RM(100, 5, 10));
  });

  it('keeps the best working set of a session', () => {
    const sets = [
      { weight: 40, reps: 10, rpe: 8 }, // 40 × (1 + 12/30) = 56
      { weight: 42.5, reps: 8, rpe: 9 }, // 42.5 × (1 + 9/30) = 55.25
      { weight: 40, reps: 9, rpe: 9.5 }, // 40 × (1 + 9.5/30) = 52.67
    ];
    expect(bestE1RM('weighted', sets)).toBeCloseTo(56, 6);
  });

  it('is not computed for timed or bodyweight exercises, nor without load', () => {
    const sets = [{ weight: 10, reps: 10, rpe: 8 }];
    expect(bestE1RM('timed', sets)).toBeNull();
    expect(bestE1RM('bodyweight', sets)).toBeNull();
    expect(bestE1RM('weighted', [{ weight: null, reps: 10, rpe: 8 }])).toBeNull();
    expect(bestE1RM('weighted', [])).toBeNull();
  });
});
