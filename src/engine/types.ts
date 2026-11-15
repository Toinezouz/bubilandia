/**
 * Engine input/output types. Deliberately independent from the database and React so the
 * engine can be ported as-is (e.g. to Swift) and tested in isolation.
 */

export type ExerciseKind = 'weighted' | 'bodyweight' | 'timed';

/** One completed working set (warm-ups are never passed to the engine). */
export interface PerformedSet {
  /** kg; null = bodyweight without added load (and always null for timed exercises). */
  weight: number | null;
  /** Reps, or seconds for timed exercises. */
  reps: number;
  rpe: number | null;
}

export interface RepRange {
  min: number;
  max: number;
}
