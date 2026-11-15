/**
 * Estimated one-rep max (§7.3): RPE-adjusted Epley.
 *   effectiveReps = reps + (10 − RPE)
 *   e1RM = weight × (1 + effectiveReps / 30)
 */

import type { ExerciseKind, PerformedSet } from './types.ts';

/** A missing RPE counts as 10 (no reps in reserve): the conservative estimate. */
export function estimateE1RM(weight: number, reps: number, rpe: number | null): number {
  const effectiveReps = reps + (10 - (rpe ?? 10));
  return weight * (1 + effectiveReps / 30);
}

/**
 * Best e1RM over a session's working sets. Null for timed / bodyweight exercises
 * and when no set has a positive load and at least one rep.
 */
export function bestE1RM(kind: ExerciseKind, sets: ReadonlyArray<PerformedSet>): number | null {
  if (kind !== 'weighted') return null;
  let best: number | null = null;
  for (const set of sets) {
    if (set.weight === null || set.weight <= 0 || set.reps <= 0) continue;
    const value = estimateE1RM(set.weight, set.reps, set.rpe);
    if (best === null || value > best) best = value;
  }
  return best;
}
