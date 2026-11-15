import { describe, expect, it } from 'vitest';
import { findRecords, totalVolume } from '../../src/engine/records.ts';
import type { PerformedSet } from '../../src/engine/types.ts';

const set = (weight: number | null, reps: number, rpe: number | null = 8): PerformedSet => ({ weight, reps, rpe });

describe('findRecords', () => {
  const previous = [set(40, 10), set(40, 10), set(42.5, 8)];

  it('nothing on the first session', () => {
    expect(findRecords([], [set(40, 10)])).toEqual([]);
  });

  it('detects a better e1RM', () => {
    // 42,5 × 9 @ 8 → 42,5 × (1 + 11/30) = 58,08 > previous best 42,5 × (1 + 10/30) = 56,67
    const records = findRecords(previous, [set(42.5, 9)]);
    expect(records[0]).toMatchObject({ type: 'e1rm', weight: 42.5, reps: 9 });
    expect((records[0] as { e1rm: number }).e1rm).toBeCloseTo(58.083, 2);
  });

  it('detects a heavier load for the same or fewer reps', () => {
    const records = findRecords(previous, [set(45, 8, 9.5)]);
    expect(records).toContainEqual({ type: 'weight_for_reps', weight: 45, reps: 8 });
  });

  it('does not call it a record when more reps were done with that load before', () => {
    // 42,5 × 6 is not a record: 42,5 × 8 was already done.
    expect(findRecords(previous, [set(42.5, 6, 10)])).toEqual([]);
  });

  it('ignores rep counts never reached before (no reference)', () => {
    const records = findRecords(previous, [set(41, 12, 10)]);
    expect(records.some((r) => r.type === 'weight_for_reps')).toBe(false);
  });

  it('keeps only the heaviest load record of the day', () => {
    const records = findRecords(previous, [set(45, 8, 10), set(47.5, 6, 10)]);
    expect(records.filter((r) => r.type === 'weight_for_reps')).toEqual([{ type: 'weight_for_reps', weight: 47.5, reps: 6 }]);
  });

  it('ignores sets without load', () => {
    expect(findRecords([set(null, 10)], [set(null, 15)])).toEqual([]);
  });
});

describe('totalVolume', () => {
  it('sums load × reps', () => {
    expect(totalVolume([set(40, 10), set(42.5, 8), set(null, 12)])).toBe(740);
  });
});
