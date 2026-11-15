/**
 * Adjustments during the workout (§7.5): "forma del día", load suggestions after the first
 * working set, bonus set, light session. Never applied automatically: the UI asks first.
 */

import type { ExerciseKind, PerformedSet } from './types.ts';
import { addIncrements, reduceByFraction, roundToIncrement } from './weight.ts';

export type Readiness = 'high' | 'normal' | 'low';

// ─── After the first working set ────────────────────────────────────────────────

export type InSessionAdjustment = { kind: 'increase' | 'decrease'; weight: number } | null;

export const DAY_HARD_FRACTION = 0.05;

/**
 * Compares the first working set with its target:
 * - much better (reps ≥ target and RPE ≤ 6.5) → +1 increment for the next sets;
 * - much worse (RPE ≥ 9.5 with reps < target, or reps < repMin) → −5 % for the next sets;
 * - otherwise nothing. Only for exercises with a load.
 */
export function adjustAfterFirstSet(input: {
  kind: ExerciseKind;
  increment: number;
  repMin: number;
  targetReps: number;
  firstSet: PerformedSet;
}): InSessionAdjustment {
  const { kind, increment, repMin, targetReps, firstSet } = input;
  if (kind === 'timed' || firstSet.weight === null || firstSet.weight <= 0) return null;
  const { weight, reps, rpe } = firstSet;

  if (reps < repMin || (rpe !== null && rpe >= 9.5 && reps < targetReps)) {
    return { kind: 'decrease', weight: reduceByFraction(weight, increment, DAY_HARD_FRACTION) };
  }
  if (rpe !== null && rpe <= 6.5 && reps >= targetReps) {
    return { kind: 'increase', weight: addIncrements(weight, increment, 1) };
  }
  return null;
}

// ─── Form of the day ─────────────────────────────────────────────────────────────

export interface ReadinessSample {
  reps: number;
  rpe: number | null;
  /** Reps planned for that set (pre-filled target). */
  targetReps: number;
  targetRPE: number;
}

/** Exercises taken into account for the form of the day. */
export const READINESS_EXERCISES = 2;

/**
 * Average gap between how hard the sets were and how hard they were planned to be, in
 * "reps in reserve" units: (RPE − target RPE) + (target reps − reps). Positive = harder than
 * expected. Missing reps count as much as missing reserve (one rep short ≈ one RPE point).
 * Null without usable samples.
 */
export function readinessScore(samples: ReadonlyArray<ReadinessSample>): number | null {
  const usable = samples.filter((s) => s.rpe !== null);
  if (usable.length === 0) return null;
  const total = usable.reduce((sum, s) => sum + (s.rpe! - s.targetRPE) + (s.targetReps - s.reps), 0);
  return total / usable.length;
}

/** ≥ +1 → baja, ≤ −1 → alta, otherwise normal. */
export function readinessLevel(score: number): Readiness {
  if (score >= 1) return 'low';
  if (score <= -1) return 'high';
  return 'normal';
}

// ─── Bonus set & light session ──────────────────────────────────────────────────

/** "2-3 series": the 3rd set is offered only if the last set was RPE ≤ 8 on a normal/good day. */
export function bonusSetAllowed(input: { lastSetRpe: number | null; readiness: Readiness | null; lightSession: boolean }): boolean {
  if (input.lightSession || input.readiness === 'low') return false;
  return input.lastSetRpe !== null && input.lastSetRpe <= 8;
}

export const LIGHT_SESSION_FRACTION = 0.1;

/** "¿Hacemos una sesión ligera hoy?" → −10 % on the remaining loads. */
export function lightSessionWeight(weight: number, increment: number): number {
  return reduceByFraction(weight, increment, LIGHT_SESSION_FRACTION);
}

/** Offer the light session once, when the first two exercises show a low form. */
export function shouldOfferLightSession(input: {
  exercisesMeasured: number;
  readiness: Readiness | null;
  alreadyOffered: boolean;
}): boolean {
  return !input.alreadyOffered && input.exercisesMeasured >= READINESS_EXERCISES && input.readiness === 'low';
}

// ─── Warm-up (§6.2) ─────────────────────────────────────────────────────────────

/**
 * Warm-up before the first compound exercise: ~50 % × 10 then ~70 % × 5 of the working load,
 * rounded to the increment. Sets that would not be lighter than the working load are dropped.
 */
export function warmupSets(workWeight: number | null, increment: number): Array<{ weight: number; reps: number }> {
  if (workWeight === null || workWeight <= 0) return [];
  const plan = [
    { fraction: 0.5, reps: 10 },
    { fraction: 0.7, reps: 5 },
  ];
  const sets: Array<{ weight: number; reps: number }> = [];
  for (const p of plan) {
    const rounded = roundToIncrement(workWeight * p.fraction, increment);
    if (rounded >= workWeight) continue;
    if (sets.some((s) => s.weight === rounded)) continue;
    sets.push({ weight: rounded, reps: p.reps });
  }
  return sets;
}
