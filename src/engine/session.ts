/**
 * Adjustments during the workout (§7.5): "forma del día", load suggestions after the first
 * working set, bonus set, light session. Never applied automatically: the UI asks first.
 */

import { estimateE1RM } from './e1rm.ts';
import type { ExerciseKind, PerformedSet } from './types.ts';
import { MAX_LOAD_CHANGE, loadFor, repsAtTarget, repsFor } from './progression.ts';
import { addIncrements, floorToIncrement, reduceByFraction, roundToIncrement } from './weight.ts';

export type Readiness = 'high' | 'normal' | 'low';

// ─── After the first working set ────────────────────────────────────────────────

export type InSessionAdjustment = { kind: 'increase' | 'decrease'; weight: number; reps: number } | null;

/** A gap of this many reps (at the target RPE) between the first set and its target is a clear sign. */
export const FORM_GAP_REPS = 2;

/**
 * "Forma del día" on the first working set: what she actually had in her (reps + reserve,
 * read at the target RPE) against what was planned.
 * - 2+ reps more than planned → heavier load for the next sets ("Hoy vas fuerte");
 * - 2+ reps fewer → lighter load ("Día duro").
 * The new load is computed from today's strength so the next set lands on its target at the
 * target RPE (rounded down, so it is achievable), within ±12 %. Only for exercises with a load.
 */
export function adjustAfterFirstSet(input: {
  kind: ExerciseKind;
  increment: number;
  repMin: number;
  repMax: number;
  targetRPE: number;
  /** Planned reps of the first set. */
  targetReps: number;
  /** Planned reps of the next set (to aim the new load at). */
  nextTargetReps: number;
  firstSet: PerformedSet;
}): InSessionAdjustment {
  const { kind, increment, repMin, repMax, targetRPE, targetReps, firstSet } = input;
  if (kind !== 'weighted' || firstSet.weight === null || firstSet.weight <= 0 || firstSet.reps <= 0) return null;
  const weight = firstSet.weight;
  const gap = repsAtTarget(firstSet, targetRPE) - targetReps;
  const harder = gap <= -FORM_GAP_REPS;
  const easier = gap >= FORM_GAP_REPS;
  if (!harder && !easier) return null;

  const todayE1RM = estimateE1RM(weight, firstSet.reps, firstSet.rpe ?? targetRPE);
  const aim = Math.min(repMax, Math.max(repMin, input.nextTargetReps));
  const ideal = floorToIncrement(loadFor(todayE1RM, aim, targetRPE), increment);
  const change = MAX_LOAD_CHANGE * weight;

  if (easier) {
    // At least one increment, at most +12 % (but one increment is always allowed, even on light loads).
    const ceiling = Math.max(addIncrements(weight, increment, 1), floorToIncrement(weight + change, increment));
    const load = Math.min(ceiling, Math.max(ideal, addIncrements(weight, increment, 1)));
    if (load <= weight) return null;
    return { kind: 'increase', weight: load, reps: Math.min(repMax, Math.max(repMin, repsFor(todayE1RM, load, targetRPE))) };
  }
  const floor = Math.min(addIncrements(weight, increment, -1), floorToIncrement(weight - change, increment));
  const load = Math.max(floor, Math.min(ideal, addIncrements(weight, increment, -1)));
  if (load >= weight) return null;
  return { kind: 'decrease', weight: load, reps: Math.min(repMax, Math.max(repMin, repsFor(todayE1RM, load, targetRPE))) };
}

/**
 * After a later set (2nd, 3rd…): fatigue check, like a coach watching the set. If she fell
 * 2+ reps short of the next target even at failure, the next set would be a grind or a miss:
 * propose a lighter load for the remaining sets, computed from that set so the next one lands
 * on its target at the target RPE (nearest step, at most −12 %). Never a heavier load
 * mid-exercise. Only for exercises with a load.
 */
export function adjustAfterLaterSet(input: {
  kind: ExerciseKind;
  increment: number;
  targetRPE: number;
  /** Planned reps of the next set. */
  nextTargetReps: number;
  set: PerformedSet;
}): InSessionAdjustment {
  const { kind, increment, targetRPE, nextTargetReps, set } = input;
  if (kind !== 'weighted' || set.weight === null || set.weight <= 0 || set.reps <= 0) return null;
  if (repsAtTarget(set, 10) > nextTargetReps - FORM_GAP_REPS) return null;
  const weight = set.weight;
  const e1rm = estimateE1RM(weight, set.reps, set.rpe ?? targetRPE);
  const floor = Math.min(addIncrements(weight, increment, -1), roundToIncrement(weight * (1 - MAX_LOAD_CHANGE), increment));
  const load = Math.max(floor, Math.min(roundToIncrement(loadFor(e1rm, nextTargetReps, targetRPE), increment), addIncrements(weight, increment, -1)));
  if (load >= weight) return null;
  return { kind: 'decrease', weight: load, reps: nextTargetReps };
}

// ─── Form of the day ─────────────────────────────────────────────────────────────

/** Exercises taken into account for the form of the day. */
export const READINESS_EXERCISES = 2;

/**
 * Strength shown by a group of sets, comparable between sessions whatever the load / reps /
 * RPE mix: the best RPE-adjusted e1RM. Without a load (bodyweight) the same formula is used
 * with a unit load, so only reps and reserve count. Null for timed exercises or no usable set.
 */
export function performanceIndex(kind: ExerciseKind, sets: ReadonlyArray<PerformedSet>): number | null {
  if (kind === 'timed') return null;
  let best: number | null = null;
  for (const s of sets) {
    if (s.reps <= 0 || s.rpe === null) continue;
    const load = s.weight !== null && s.weight > 0 ? s.weight : kind === 'bodyweight' ? 1 : null;
    if (load === null) continue;
    const value = estimateE1RM(load, s.reps, s.rpe);
    if (best === null || value > best) best = value;
  }
  return best;
}

/** One exercise: today's performance index against the last session's. */
export interface ReadinessSample {
  today: number;
  reference: number;
}

/**
 * Form of the day: average relative change of today's performance compared with the last
 * time each exercise was done (0 = same as last time, −0.05 = 5 % weaker). Doing exactly the
 * same as last time is a normal day, whatever the targets were. Null without samples.
 */
export function readinessScore(samples: ReadonlyArray<ReadinessSample>): number | null {
  const usable = samples.filter((s) => s.reference > 0);
  if (usable.length === 0) return null;
  return usable.reduce((sum, s) => sum + (s.today / s.reference - 1), 0) / usable.length;
}

/**
 * One rep (or one RPE point) is worth ≈ 2,5 % of e1RM: ±4 % means clearly more than a rep
 * off, in the same direction, on average.
 */
export const READINESS_THRESHOLD = 0.04;

/** ≤ −4 % → baja, ≥ +4 % → alta, otherwise normal. */
export function readinessLevel(score: number): Readiness {
  if (score <= -READINESS_THRESHOLD) return 'low';
  if (score >= READINESS_THRESHOLD) return 'high';
  return 'normal';
}

// ─── Bonus set & light session ──────────────────────────────────────────────────

/**
 * "2-3 series": the bonus set is offered only when the last set was done at or below the
 * target effort (close to failure is planned: RPE 9 is fine, a grinding 10 is not) with at
 * least the bottom of the range, on a day whose form is not low and that is not lightened.
 */
export function bonusSetAllowed(input: {
  lastSetRpe: number | null;
  lastSetReps: number | null;
  repMin: number;
  targetRPE: number;
  readiness: Readiness | null;
  lightSession: boolean;
}): boolean {
  if (input.lightSession || input.readiness === 'low') return false;
  if (input.lastSetRpe === null || input.lastSetReps === null) return false;
  // One rep less on the last set is normal fatigue with a fixed number of reps.
  return input.lastSetRpe <= input.targetRPE && input.lastSetReps >= input.repMin - 1;
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
