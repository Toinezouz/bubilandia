import { describe, expect, it } from 'vitest';
import { prefillForSet, suggestNext } from '../src/engine/progression.ts';
import { normalizeTarget, plannedWeeklyTargets, setsPerMuscle, volumeStatus } from '../src/engine/volume.ts';
import { formatKg, formatPerformance, formatSeconds, formatTarget, parseDecimal } from '../src/shared/format.ts';
import { newId } from '../src/shared/id.ts';

describe('format', () => {
  it('uses the Spanish decimal comma', () => {
    expect(formatKg(42.5)).toBe('42,5 kg');
    expect(formatKg(40)).toBe('40 kg');
    expect(formatKg(11.25)).toBe('11,25 kg');
  });

  it('parses both comma and dot', () => {
    expect(parseDecimal('42,5')).toBe(42.5);
    expect(parseDecimal(' 42.5 ')).toBe(42.5);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('-3')).toBeNull();
  });

  it('formats the last performance', () => {
    const s = (weight: number | null, reps: number) => ({ weight, reps, rpe: 8 });
    expect(formatPerformance([s(40, 10), s(40, 10), s(40, 9)], 'weighted')).toBe('40 kg × 10, 10, 9');
    expect(formatPerformance([s(40, 10), s(42.5, 9), s(42.5, 8)], 'weighted')).toBe('40 kg × 10 · 42,5 kg × 9, 8');
    expect(formatPerformance([s(null, 10), s(null, 9)], 'bodyweight')).toBe('10, 9 reps');
    expect(formatPerformance([s(null, 45), s(null, 40)], 'timed')).toBe('45, 40 s');
    expect(formatPerformance([], 'weighted')).toBe('—');
  });

  it('formats today’s target', () => {
    const base = { kind: 'weighted' as const, repRange: { min: 8, max: 12 }, increment: 2.5, targetRPE: 8 };
    const up = suggestNext({ ...base, lastSets: [12, 12, 12].map((reps) => ({ weight: 40, reps, rpe: 8 })) });
    // 12 × 40 kg @ 8: e1RM 58,7 → new load 42,5 kg, 9 reps at RPE 8 on every set.
    expect(formatTarget(up, 'weighted')).toBe('42,5 kg × 9');
    const addRep = suggestNext({ ...base, lastSets: [10, 9, 8].map((reps) => ({ weight: 40, reps, rpe: 8 })) });
    expect(formatTarget(addRep, 'weighted')).toBe('40 kg × 11, 10, 9');
    const same = suggestNext({ ...base, lastSets: [9, 9, 9].map((reps) => ({ weight: 40, reps, rpe: 8 })) });
    expect(formatTarget(same, 'weighted', true)).toBe('40 kg × 10 / lado');
    expect(formatTarget(suggestNext({ ...base, lastSets: [] }), 'weighted')).toBeNull();
  });

  it('formats rest durations', () => {
    expect(formatSeconds(150)).toBe('2:30');
    expect(formatSeconds(75)).toBe('1:15');
    expect(formatSeconds(45)).toBe('0:45');
  });

  it('generates unique ids', () => {
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(newId()).not.toBe(newId());
  });
});

describe('prefillForSet', () => {
  const base = { kind: 'weighted' as const, repRange: { min: 8, max: 12 }, increment: 2.5, targetRPE: 8 };

  it('uses per-set targets, reusing the last one for extra sets', () => {
    const s = suggestNext({ ...base, lastSets: [10, 9].map((reps) => ({ weight: 40, reps, rpe: 8 })) });
    expect(prefillForSet(s, 0)).toEqual({ weight: 40, reps: 11 });
    expect(prefillForSet(s, 1)).toEqual({ weight: 40, reps: 10 });
    expect(prefillForSet(s, 2)).toEqual({ weight: 40, reps: 10 });
  });

  it('starts the new load in the lower part of the range', () => {
    const s = suggestNext({ ...base, lastSets: [12, 12].map((reps) => ({ weight: 40, reps, rpe: 8 })) });
    // 12 × 40 kg @ 8 → 42,5 kg; 9 reps at the target RPE: the lower part of the 8-12 range.
    expect(prefillForSet(s, 0)).toEqual({ weight: 42.5, reps: 9 });
  });

  it('leaves the load empty when calibrating', () => {
    expect(prefillForSet(suggestNext({ ...base, lastSets: [] }), 0)).toEqual({ weight: null, reps: 10 });
  });
});

describe('weekly volume', () => {
  it('counts 1 per set for the primary muscle and 0.5 for the secondary', () => {
    expect(
      setsPerMuscle([
        { primaryMuscle: 'glutes', secondaryMuscle: null, sets: 3 }, // hip thrust
        { primaryMuscle: 'quads', secondaryMuscle: 'glutes', sets: 3 }, // prensa
        { primaryMuscle: 'back', secondaryMuscle: 'biceps', sets: 0 }, // skipped
      ]),
    ).toEqual({ glutes: 4.5, quads: 3 });
  });

  it('compares against the target range', () => {
    expect(volumeStatus(7, { min: 8, max: 10 })).toBe('below');
    expect(volumeStatus(8, { min: 8, max: 10 })).toBe('within');
    expect(volumeStatus(10.5, { min: 8, max: 10 })).toBe('above');
  });
});

describe('editing a weekly target', () => {
  it('keeps min ≤ max: the bound she just changed wins', () => {
    expect(normalizeTarget({ min: 12, max: 10 }, 'min')).toEqual({ min: 12, max: 12 });
    expect(normalizeTarget({ min: 12, max: 10 }, 'max')).toEqual({ min: 10, max: 10 });
    expect(normalizeTarget({ min: 8, max: 10 }, 'min')).toEqual({ min: 8, max: 10 });
  });

  it('stays within 0-40 whole sets', () => {
    expect(normalizeTarget({ min: -3, max: 99 }, 'max')).toEqual({ min: 0, max: 40 });
    expect(normalizeTarget({ min: 8.4, max: 10.6 }, 'min')).toEqual({ min: 8, max: 11 });
  });
});

describe('weekly targets from the program', () => {
  it('minimum = base sets, maximum = with bonus sets, secondary muscles count half', () => {
    const t = plannedWeeklyTargets(
      [
        { primaryMuscle: 'glutes', secondaryMuscle: null, baseSets: 3, extraSets: 0 },
        { primaryMuscle: 'quads', secondaryMuscle: 'glutes', baseSets: 3, extraSets: 0 }, // +1,5 glutes
        { primaryMuscle: 'glutes', secondaryMuscle: null, baseSets: 2, extraSets: 1 },
      ],
      ['glutes', 'quads', 'chest'],
    );
    expect(t).toEqual({ glutes: { min: 6, max: 8 }, quads: { min: 3, max: 3 }, chest: { min: 0, max: 0 } });
  });
});
