/**
 * Next-session suggestion (§7.4): double progression driven by RPE.
 *
 * Input: the working sets from the last time this exercise was done (the caller excludes
 * warm-ups and deload sessions), the template rep range, the increment and the target RPE.
 * Output: today's load and rep targets, plus an optional Spanish hint for the UI.
 */

import { averageRpe } from './rpe.ts';
import type { ExerciseKind, PerformedSet, RepRange } from './types.ts';
import { addIncrements, reduceByFraction, toHundredths } from './weight.ts';

export type ProgressionDecision =
  /** No usable history: first session is for calibration. */
  | 'calibrate'
  /** All sets at the top of the range, RPE ≤ 9 → +1 increment. */
  | 'increase'
  /** All sets at the top of the range, RPE ≤ 7 → +2 increments. */
  | 'increase_double'
  /** In the range but not all at the top → same load, +1 rep per set. */
  | 'add_rep'
  /** All sets at the top but too hard to add load (RPE > 9) → same load, same reps. */
  | 'keep'
  /** ≥ 2 sets under the range, or RPE ≥ 9.5 with low reps → −5 %. */
  | 'decrease'
  /** Timed: all sets at the top with RPE ≤ 8.5 → range shifted by +increment seconds. */
  | 'extend_time'
  /** Timed: the shifted range would go beyond 60 s → suggest a harder variant. */
  | 'harder_variant'
  /** Bodyweight: all sets above the top of the range → suggest adding load. */
  | 'add_load';

export interface ProgressionInput {
  kind: ExerciseKind;
  /** Template range (reps, or seconds for timed exercises). */
  repRange: RepRange;
  /** kg, or seconds for timed exercises. */
  increment: number;
  targetRPE: number;
  /** Working sets of the last session on this exercise; empty if never done. */
  lastSets: ReadonlyArray<PerformedSet>;
}

export interface Suggestion {
  decision: ProgressionDecision;
  /** Load to pre-fill; null = let her choose (calibration) or no load (bodyweight / timed). */
  weight: number | null;
  /** Target range shown as "Hoy: 42,5 kg × 8-10". */
  repRange: RepRange;
  /** Per-set targets when they differ from the range (add_rep), else null. */
  perSetReps: number[] | null;
  /** Spanish message for the UI, if any. */
  hint: string | null;
}

/** Beyond this, a timed exercise should move to a harder variant. */
export const TIMED_MAX_SECONDS = 60;
/** Fraction removed when a load must go down. */
export const DECREASE_FRACTION = 0.05;

export function suggestNext(input: ProgressionInput): Suggestion {
  const { kind, repRange, increment, lastSets } = input;

  if (lastSets.length === 0) return calibrate(kind, repRange);
  if (kind === 'timed') return suggestTimed(input);

  const weight = referenceWeight(lastSets);
  if (kind === 'weighted' && weight === null) return calibrate(kind, repRange);

  const outcome = classify(input, repRange);
  const unloaded = weight === null; // bodyweight without added load

  switch (outcome) {
    case 'decrease':
      return unloaded
        ? result('decrease', null, repRange, null, 'Cuesta mucho: prueba una versión más fácil del ejercicio.')
        : result('decrease', reduceByFraction(weight, increment, DECREASE_FRACTION), repRange, null, null);
    case 'increase':
    case 'increase_double': {
      const lowRange = { min: repRange.min, max: Math.min(repRange.min + 2, repRange.max) };
      if (unloaded) {
        return result('add_load', increment, lowRange, null, `Ya pasas de ${repRange.max} reps: añade ${formatKg(increment)} kg.`);
      }
      const steps = outcome === 'increase_double' ? 2 : 1;
      return result(outcome, addIncrements(weight, increment, steps), lowRange, null, null);
    }
    case 'keep':
      return result('keep', weight, repRange, lastSets.map((s) => s.reps), null);
    case 'add_rep':
      return result(
        'add_rep',
        weight,
        repRange,
        lastSets.map((s) => Math.min(s.reps + 1, repRange.max)),
        null,
      );
  }
}

type Outcome = 'decrease' | 'increase' | 'increase_double' | 'keep' | 'add_rep';

/**
 * Shared decision table. `range` is the range the sets are judged against
 * (the template range, or the shifted one for timed exercises).
 */
function classify(input: ProgressionInput, range: RepRange, maxRpeToProgress = 9): Outcome {
  const reps = input.lastSets.map((s) => s.reps);
  const avgRpe = averageRpe(input.lastSets.map((s) => s.rpe), input.targetRPE);
  const avgReps = reps.reduce((a, b) => a + b, 0) / reps.length;
  const middle = (range.min + range.max) / 2;

  const setsBelowMin = reps.filter((r) => r < range.min).length;
  if (setsBelowMin >= 2 || (avgRpe >= 9.5 && avgReps < middle)) return 'decrease';

  if (reps.every((r) => r >= range.max)) {
    if (avgRpe <= 7 && input.kind !== 'timed') return 'increase_double';
    if (avgRpe <= maxRpeToProgress) return 'increase';
    return 'keep';
  }
  return 'add_rep';
}

/**
 * Timed exercises (plancha): same logic in seconds. The step is the increment (5 s).
 * The current range is the template range shifted up until her weakest set fits in it,
 * so progress made in previous sessions is kept without storing extra state.
 */
function suggestTimed(input: ProgressionInput): Suggestion {
  const { repRange, increment: step, lastSets } = input;
  const weakest = Math.min(...lastSets.map((s) => s.reps));
  const shifts = Math.max(0, Math.ceil((weakest - repRange.max) / step));
  const current = shift(repRange, shifts, step);

  switch (classify(input, current, 8.5)) {
    case 'decrease':
      return result('decrease', null, shift(repRange, Math.max(0, shifts - 1), step), null, null);
    case 'increase':
    case 'increase_double': {
      const next = shift(repRange, shifts + 1, step);
      if (next.max > TIMED_MAX_SECONDS) {
        return result(
          'harder_variant',
          null,
          next,
          null,
          `Ya aguantas más de ${TIMED_MAX_SECONDS} s: prueba una variante más difícil (p. ej. plancha con un disco en la espalda).`,
        );
      }
      return result('extend_time', null, next, null, null);
    }
    case 'keep':
      return result('keep', null, current, lastSets.map((s) => s.reps), null);
    case 'add_rep':
      return result(
        'add_rep',
        null,
        current,
        lastSets.map((s) => Math.min(s.reps + step, current.max)),
        null,
      );
  }
}

/**
 * Values pre-filled in set row `setIndex` (0-based): the suggested load, and the per-set
 * target when there is one (extra sets reuse the last one), else the bottom of the range.
 * When calibrating, reps default to ~repMax − 2 and the load is left empty.
 */
export function prefillForSet(s: Suggestion, setIndex: number): { weight: number | null; reps: number } {
  if (s.perSetReps && s.perSetReps.length > 0) {
    const reps = s.perSetReps[Math.min(setIndex, s.perSetReps.length - 1)]!;
    return { weight: s.weight, reps };
  }
  if (s.decision === 'calibrate') {
    return { weight: null, reps: Math.max(s.repRange.min, s.repRange.max - 2) };
  }
  return { weight: s.weight, reps: s.repRange.min };
}

function calibrate(kind: ExerciseKind, repRange: RepRange): Suggestion {
  const aim = Math.max(repRange.min, repRange.max - 2);
  const hint =
    kind === 'weighted'
      ? `Elige un peso con el que hagas ~${aim} reps dejando 2 en reserva.`
      : kind === 'timed'
        ? `Aguanta ~${aim} s dejando un margen.`
        : `Haz ~${aim} reps dejando 2 en reserva.`;
  return result('calibrate', null, repRange, null, hint);
}

/**
 * The load used for most sets (ties → the heavier one). Handles sessions where the load
 * changed mid-exercise. Null when no set carried a load.
 */
export function referenceWeight(sets: ReadonlyArray<PerformedSet>): number | null {
  const counts = new Map<number, number>();
  for (const s of sets) {
    if (s.weight === null || s.weight <= 0) continue;
    const key = toHundredths(s.weight);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: { key: number; count: number } | null = null;
  for (const [key, count] of counts) {
    if (!best || count > best.count || (count === best.count && key > best.key)) best = { key, count };
  }
  return best ? best.key / 100 : null;
}

function shift(range: RepRange, times: number, step: number): RepRange {
  return { min: range.min + times * step, max: range.max + times * step };
}

function result(
  decision: ProgressionDecision,
  weight: number | null,
  repRange: RepRange,
  perSetReps: number[] | null,
  hint: string | null,
): Suggestion {
  return { decision, weight, repRange, perSetReps, hint };
}

/** "2,5" — Spanish decimal comma, no trailing zeros. */
function formatKg(kg: number): string {
  return String(kg).replace('.', ',');
}
