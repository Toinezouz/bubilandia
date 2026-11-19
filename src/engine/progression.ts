/**
 * Next-session suggestion (§7.4, revised): double progression for bodybuilding, sets taken
 * close to failure inside the program's rep ranges.
 *
 * The RPE she logs after each set tells how many more reps she could have done. From the
 * last session we know her real capacity, so we can prescribe:
 * - the same load and one more rep than she could do at the target RPE, while she is inside
 *   the range;
 * - a heavier load as soon as she reaches the top of the range (whatever the RPE: training
 *   close to failure must never block the load increase), computed from her e1RM so that
 *   she lands in the lower part of the range at the target RPE;
 * - a lighter load, computed the same way, when she cannot reach the bottom of the range.
 * Rep targets always stay inside the range.
 */

import { estimateE1RM } from './e1rm.ts';
import type { ExerciseKind, PerformedSet, RepRange } from './types.ts';
import { addIncrements, floorToIncrement, roundToIncrement, toHundredths } from './weight.ts';

export type ProgressionDecision =
  /** No usable history: first session is for calibration. */
  | 'calibrate'
  /** Top of the range reached → heavier load, back to the lower part of the range. */
  | 'increase'
  /** Inside the range → same load, one more rep than her capacity at the target RPE. */
  | 'add_rep'
  /** Inside the range, at the top already for every set → same load, same reps. */
  | 'keep'
  /** Bottom of the range not reachable → lighter load. */
  | 'decrease'
  /** Timed: top of the range reached → range shifted by +increment seconds. */
  | 'extend_time'
  /** Timed: the shifted range would go beyond 60 s → suggest a harder variant. */
  | 'harder_variant'
  /** Bodyweight: top of the range reached → suggest adding load. */
  | 'add_load';

export interface ProgressionInput {
  kind: ExerciseKind;
  /** Template range (reps, or seconds for timed exercises). */
  repRange: RepRange;
  /** kg, or seconds for timed exercises. */
  increment: number;
  /** RPE aimed at the end of each set (9 = one rep in reserve). */
  targetRPE: number;
  /** Working sets of the last session on this exercise; empty if never done. */
  lastSets: ReadonlyArray<PerformedSet>;
  /**
   * Working sets of the session before (if any). Used like a coach would: a single bad
   * session does not lower the load, a confirmed one does.
   */
  previousSets?: ReadonlyArray<PerformedSet>;
}

export interface Suggestion {
  decision: ProgressionDecision;
  /** Load to pre-fill; null = let her choose (calibration) or no load (bodyweight / timed). */
  weight: number | null;
  /** Target range shown as "Hoy: 42,5 kg × 8-10". */
  repRange: RepRange;
  /** Per-set rep targets, always inside the range (null when only a range is known). */
  perSetReps: number[] | null;
  /** Spanish message for the UI, if any. */
  hint: string | null;
}

/** Beyond this, a timed exercise should move to a harder variant. */
export const TIMED_MAX_SECONDS = 60;
/** A computed load never jumps more than this in one session (protects against odd logs). */
export const MAX_LOAD_CHANGE = 0.12;

// ─── Capacity model ─────────────────────────────────────────────────────────────

/** Reps she could have done at `targetRPE` with the same load (missing RPE = as planned). */
export function repsAtTarget(set: PerformedSet, targetRPE: number): number {
  return set.reps + targetRPE - (set.rpe ?? targetRPE);
}

/** Load that should give `reps` at `rpe` for this e1RM (inverse of the RPE-adjusted Epley). */
export function loadFor(e1rm: number, reps: number, rpe: number): number {
  return e1rm / (1 + (reps + 10 - rpe) / 30);
}

/** Reps expected at `rpe` with `load`, for this e1RM. */
export function repsFor(e1rm: number, load: number, rpe: number): number {
  return Math.floor(30 * (e1rm / load - 1) + 1e-9) - (10 - rpe);
}

/** Lower part of the range, where a new load should start: 6-10 → 7, 8-12 → 9, 12-20 → 14. */
export function entryReps(range: RepRange): number {
  return range.min + Math.round((range.max - range.min) / 4);
}

const clamp = (n: number, range: RepRange) => Math.min(range.max, Math.max(range.min, Math.round(n)));

// ─── Suggestion ─────────────────────────────────────────────────────────────────

export function suggestNext(input: ProgressionInput): Suggestion {
  const { kind, repRange, lastSets } = input;
  const usable = lastSets.filter((s) => s.reps > 0);
  if (usable.length === 0) return calibrate(kind, repRange, input.targetRPE);
  if (isFixed(repRange)) return suggestFixed({ ...input, lastSets: usable });
  if (kind === 'timed') return suggestTimed({ ...input, lastSets: usable });

  const weight = referenceWeight(usable);
  if (kind === 'weighted' && weight === null) return calibrate(kind, repRange, input.targetRPE);
  // Sets done with the reference load (if the load changed mid-exercise, the others are ignored).
  const sets = weight === null ? usable : usable.filter((s) => s.weight !== null && toHundredths(s.weight) === toHundredths(weight));
  return weight === null || kind === 'bodyweight'
    ? suggestBodyweight({ ...input, lastSets: sets }, weight)
    : suggestWeighted({ ...input, lastSets: sets }, weight);
}

function suggestWeighted(input: ProgressionInput, weight: number): Suggestion {
  const { repRange, increment, targetRPE, lastSets } = input;
  const first = lastSets[0]!;
  const capacity = repsAtTarget(first, targetRPE);
  // Strength shown last time (best set), with a missing RPE read as "as planned".
  const e1rm = Math.max(...lastSets.map((s) => estimateE1RM(s.weight!, s.reps, s.rpe ?? targetRPE)));
  // Reps lost from one set to the next last time (fatigue), applied to today's targets.
  const drops = lastSets.map((s) => Math.max(0, first.reps - s.reps));

  if (first.reps >= repRange.max || capacity > repRange.max) {
    const raw = floorToIncrement(loadFor(e1rm, entryReps(repRange), targetRPE), increment);
    const ceiling = Math.max(addIncrements(weight, increment, 1), floorToIncrement(weight * (1 + MAX_LOAD_CHANGE), increment));
    const load = Math.min(ceiling, Math.max(raw, addIncrements(weight, increment, 1)));
    // The step must be doable: with the new load she must reach the bottom of the range, at
    // worst at failure. Otherwise (big step for a light load, e.g. 2,5 kg on 25 kg) she stays
    // at the top of the range until she is strong enough — no up-and-down from one session to
    // the next.
    if (repsFor(e1rm, load, 10) >= repRange.min) return targetsAtLoad('increase', load, e1rm, input, drops);
    return result('keep', weight, repRange, drops.map((d) => clamp(repRange.max - d, repRange)), null);
  }

  // Lighter only if she could not reach the bottom of the range even at failure. Judged on
  // capacity, not raw reps: 7 reps at RPE 7 is a set stopped early, not a load too heavy.
  if (repsAtTarget(first, 10) < repRange.min) {
    const raw = floorToIncrement(loadFor(e1rm, entryReps(repRange), targetRPE), increment);
    const floor = floorToIncrement(weight * (1 - MAX_LOAD_CHANGE * 1.5), increment);
    const load = Math.max(floor, Math.min(raw, addIncrements(weight, increment, -1)));
    return targetsAtLoad('decrease', load, e1rm, input, drops);
  }

  // Same load: one more rep than she could do at the target RPE (progress), inside the range.
  const perSetReps = lastSets.map((s) => clamp(repsAtTarget(s, targetRPE) + 1, repRange));
  const progressing = perSetReps.some((r, i) => r > lastSets[i]!.reps);
  return result(progressing ? 'add_rep' : 'keep', weight, repRange, perSetReps, null);
}

/** Targets for a new load: first set from her e1RM, next ones with last session's fatigue. */
function targetsAtLoad(decision: 'increase' | 'decrease', load: number, e1rm: number, input: ProgressionInput, drops: number[]): Suggestion {
  const firstTarget = clamp(repsFor(e1rm, load, input.targetRPE), input.repRange);
  const perSetReps = drops.map((d) => clamp(firstTarget - d, input.repRange));
  return result(decision, load, input.repRange, perSetReps, null);
}

/**
 * Bodyweight: reps first; once she reaches the top of the range, suggest adding a small load.
 * With an added load, the load moves one increment at a time (the e1RM model would ignore
 * her body weight).
 */
function suggestBodyweight(input: ProgressionInput, weight: number | null): Suggestion {
  const { repRange, increment, targetRPE, lastSets } = input;
  const first = lastSets[0]!;
  const capacity = repsAtTarget(first, targetRPE);
  const drops = lastSets.map((s) => Math.max(0, first.reps - s.reps));
  const lowTargets = drops.map((d) => clamp(entryReps(repRange) - d, repRange));

  if (first.reps >= repRange.max || capacity > repRange.max) {
    if (weight === null) {
      return result('add_load', increment, repRange, lowTargets, `Ya llegas a ${repRange.max} reps: añade ${formatKg(increment)} kg.`);
    }
    return result('increase', addIncrements(weight, increment, 1), repRange, lowTargets, null);
  }
  if (capacity < repRange.min) {
    if (weight === null) {
      return result('decrease', null, repRange, lowTargets, 'Cuesta mucho: prueba una versión más fácil del ejercicio.');
    }
    const lighter = toHundredths(weight) > toHundredths(increment) ? addIncrements(weight, increment, -1) : null;
    return result('decrease', lighter, repRange, lowTargets, null);
  }
  const perSetReps = lastSets.map((s) => clamp(repsAtTarget(s, targetRPE) + 1, repRange));
  const progressing = perSetReps.some((r, i) => r > lastSets[i]!.reps);
  return result(progressing ? 'add_rep' : 'keep', weight, repRange, perSetReps, null);
}

/**
 * Timed exercises (plancha): same idea in seconds, the step is the increment (5 s). The
 * current range is the template range shifted up until her weakest hold fits in it, so
 * progress is kept without extra state. Reaching the top moves the range up, whatever the RPE.
 */
function suggestTimed(input: ProgressionInput): Suggestion {
  const { repRange, increment: step, lastSets } = input;
  const holds = lastSets.map((s) => s.reps);
  const weakest = Math.min(...holds);
  const shifts = Math.max(0, Math.ceil((weakest - repRange.max) / step));
  const current = shift(repRange, shifts, step);

  if (holds.filter((h) => h < current.min).length >= 2) {
    const back = shift(repRange, Math.max(0, shifts - 1), step);
    return result('decrease', null, back, holds.map((h) => clamp(h, back)), null);
  }
  if (holds.every((h) => h >= current.max)) {
    const next = shift(repRange, shifts + 1, step);
    const hint =
      next.max > TIMED_MAX_SECONDS
        ? `Ya aguantas más de ${TIMED_MAX_SECONDS} s: prueba una variante más difícil (p. ej. plancha con un disco en la espalda).`
        : null;
    return result(hint ? 'harder_variant' : 'extend_time', null, next, holds.map(() => next.min), hint);
  }
  return result('add_rep', null, current, holds.map((h) => clamp(h + step, current)), null);
}

// ─── Fixed reps ─────────────────────────────────────────────────────────────────

/** Most extra reps asked over the fixed number while waiting for a big load step. */
export const FIXED_EXTRA_REPS = 5;

/** A template line with a fixed number of reps (repMin = repMax). */
export function isFixed(range: RepRange): boolean {
  return range.min === range.max;
}

/**
 * Fixed reps (the default program): every set asks for the same number of reps R, close to
 * failure (target RPE). Only the load moves, from what she reports on the first set:
 * - R reps with at least one more rep in reserve than planned (e.g. RPE ≤ 8 for a target of
 *   9), or more than R reps → heavier, computed from her e1RM so that R reps land on the
 *   target RPE (at least one increment, at most +12 %, and only if R − 1 reps stay doable);
 * - R reps at the planned effort, or one rep short → same load (try again: strength comes);
 * - two reps or more short even at failure → lighter, computed the same way, but only when
 *   it is confirmed: a clear miss (4+ reps) or a second short session in a row. A single bad
 *   day (sleep, stress, cycle…) repeats the load instead, as a coach would.
 * The load only goes up when the whole session held: the last set must still reach R − 1
 * at failure (otherwise she consolidates the current load first).
 * Timed exercises: the same idea in seconds, the hold moves by one increment (5 s).
 */
function suggestFixed(input: ProgressionInput): Suggestion {
  const { kind, repRange, increment, targetRPE, lastSets } = input;
  const reps = repRange.min;
  const all = lastSets.map(() => reps);
  if (kind === 'timed') return suggestFixedTimed(input);

  const weight = referenceWeight(lastSets);
  if (kind === 'weighted' && weight === null) return calibrate(kind, repRange, targetRPE);
  const sets = weight === null ? lastSets : lastSets.filter((s) => s.weight !== null && toHundredths(s.weight) === toHundredths(weight));
  const first = sets[0]!;
  const atTarget = repsAtTarget(first, targetRPE);
  const atFailure = repsAtTarget(first, 10);
  // Above the fixed number (extra reps while waiting for a big step), progress is judged on
  // the reps actually asked: same rule, the load goes up as soon as it is doable.
  const easier = atTarget >= reps + 1;
  const harder = atFailure <= reps - 2;
  // The whole session held: even the last (most tired) set reached R − 1 at failure.
  const last = sets[sets.length - 1]!;
  const heldToTheEnd = repsAtTarget(last, 10) >= reps - 1;
  // A miss is confirmed when it is large, or when the previous session at this load (or a
  // heavier one) was already short. Otherwise it is treated as a bad day.
  // 4+ reps short (~10 % of load) is beyond day-to-day variation: the load is really too heavy.
  const confirmed = atFailure <= reps - 4 || previousWasShort(input.previousSets, weight, reps);
  const badDayHint = 'La última sesión costó más de lo normal: repetimos el peso. Si vuelve a costar, lo bajamos.';
  const consolidateHint = `La primera serie fue bien, pero las últimas cayeron: consolidamos este peso antes de subir.`;

  // Bodyweight: no e1RM with an unknown body weight — one step at a time.
  if (weight === null || kind === 'bodyweight') {
    if (easier && !heldToTheEnd) return result('keep', weight, repRange, all, consolidateHint);
    if (easier) {
      if (weight === null) return result('add_load', increment, repRange, all, `Ya haces ${reps} reps con margen: añade ${formatKg(increment)} kg.`);
      return result('increase', addIncrements(weight, increment, 1), repRange, all, null);
    }
    if (harder && !confirmed) return result('keep', weight, repRange, all, badDayHint);
    if (harder) {
      if (weight === null) return result('decrease', null, repRange, all, 'Cuesta mucho: prueba una versión más fácil del ejercicio.');
      const lighter = toHundredths(weight) > toHundredths(increment) ? addIncrements(weight, increment, -1) : null;
      return result('decrease', lighter, repRange, all, null);
    }
    return result('keep', weight, repRange, all, null);
  }

  const e1rm = Math.max(...sets.map((s) => estimateE1RM(s.weight!, s.reps, s.rpe ?? targetRPE)));
  const ideal = floorToIncrement(loadFor(e1rm, reps, targetRPE), increment);
  if (easier && !heldToTheEnd) return result('keep', weight, repRange, all, consolidateHint);
  if (harder && !confirmed) return result('keep', weight, repRange, all, badDayHint);
  if (easier) {
    const ceiling = Math.max(addIncrements(weight, increment, 1), floorToIncrement(weight * (1 + MAX_LOAD_CHANGE), increment));
    const load = Math.min(ceiling, Math.max(ideal, addIncrements(weight, increment, 1)));
    // Doable if she would be at most 2 reps short at the target effort (she still reaches
    // R − 1 at failure, so the next session keeps the load: no up-and-down). Going back to a
    // load she just missed (session before) asks for real margin: R reps at the planned
    // effort, not just at failure (RPE 6 means "4 or more" and is only a lower bound).
    const missedBefore = missedLoad(input.previousSets, reps);
    const backToMissed = missedBefore !== null && toHundredths(load) >= toHundredths(missedBefore);
    const doable = backToMissed ? repsFor(e1rm, load, targetRPE) >= reps : repsFor(e1rm, load, targetRPE) >= reps - 2;
    if (doable) return result('increase', load, repRange, all, null);
    // The step is too big for this load (e.g. 1 kg on a 9 kg dumbbell = +11 %, ~4 reps):
    // she builds a few extra reps with the same load until the next one becomes doable.
    const extra = Math.min(reps + FIXED_EXTRA_REPS, Math.max(reps, Math.round(atTarget) + 1));
    return result(
      'add_rep',
      weight,
      repRange,
      lastSets.map(() => extra),
      `Subir a ${formatKg(load)} kg aún es un salto grande: haz ${extra} reps hasta poder subir (o usa un incremento más pequeño).`,
    );
  }
  if (harder) {
    // One bad session must not cost much: at most −12 % (one increment always allowed).
    // Rounded to the nearest step (not down): with 5 kg steps, flooring 55 × 0,88 would give 45 (−18 %).
    const floor = Math.min(addIncrements(weight, increment, -1), roundToIncrement(weight * (1 - MAX_LOAD_CHANGE), increment));
    // Nearest step here (not down): rounding down would make it too light and bounce back up.
    const lighter = roundToIncrement(loadFor(e1rm, reps, targetRPE), increment);
    const load = Math.max(floor, Math.min(lighter, addIncrements(weight, increment, -1)));
    return result('decrease', load, repRange, all, null);
  }
  return result('keep', weight, repRange, all, null);
}

/** Load of the previous session if she missed it (2+ reps short at failure), else null. */
function missedLoad(previous: ReadonlyArray<PerformedSet> | undefined, reps: number): number | null {
  if (!previous || previous.length === 0) return null;
  const w = referenceWeight(previous);
  if (w === null) return null;
  const first = previous.find((s) => s.weight !== null && toHundredths(s.weight) === toHundredths(w))!;
  return repsAtTarget(first, 10) <= reps - 2 ? w : null;
}

/**
 * Was the previous session also short (2+ reps under R even at failure) with the same load or
 * a heavier one? Then the current miss is not just a bad day.
 */
function previousWasShort(previous: ReadonlyArray<PerformedSet> | undefined, weight: number | null, reps: number): boolean {
  if (!previous || previous.length === 0) return false;
  const prevWeight = referenceWeight(previous);
  if (weight !== null && (prevWeight === null || toHundredths(prevWeight) < toHundredths(weight))) return false;
  const prevFirst =
    prevWeight === null ? previous[0]! : previous.find((s) => s.weight !== null && toHundredths(s.weight) === toHundredths(prevWeight))!;
  return repsAtTarget(prevFirst, 10) <= reps - 2;
}

/**
 * Timed with a fixed hold: the last hold, rounded down to the step, is where she is; held
 * with reserve (RPE ≤ target − 1) → one step longer; beyond 60 s → harder variant.
 */
function suggestFixedTimed(input: ProgressionInput): Suggestion {
  const { repRange, increment: step, targetRPE, lastSets } = input;
  const first = lastSets[0]!;
  const floorHold = Math.max(step, Math.floor(first.reps / step) * step);
  const easy = (first.rpe ?? targetRPE) <= targetRPE - 1;
  const next = easy ? floorHold + step : floorHold;
  const range = { min: next, max: next };
  const all = lastSets.map(() => next);
  if (next > TIMED_MAX_SECONDS) {
    return result(
      'harder_variant',
      null,
      { min: TIMED_MAX_SECONDS, max: TIMED_MAX_SECONDS },
      lastSets.map(() => TIMED_MAX_SECONDS),
      `Ya aguantas más de ${TIMED_MAX_SECONDS} s: prueba una variante más difícil (p. ej. plancha con un disco en la espalda).`,
    );
  }
  if (next > repRange.min && next > first.reps) return result('extend_time', null, range, all, null);
  if (next < repRange.min && first.reps < repRange.min) return result('decrease', null, range, all, null);
  return result('keep', null, range, all, null);
}

/**
 * Values pre-filled in set row `setIndex` (0-based): the suggested load and the per-set
 * target (extra sets reuse the last one), else the middle of the range.
 */
export function prefillForSet(s: Suggestion, setIndex: number): { weight: number | null; reps: number } {
  if (s.perSetReps && s.perSetReps.length > 0) {
    const reps = s.perSetReps[Math.min(setIndex, s.perSetReps.length - 1)]!;
    return { weight: s.weight, reps };
  }
  return { weight: s.weight, reps: middle(s.repRange) };
}

const middle = (range: RepRange) => Math.round((range.min + range.max) / 2);

function calibrate(kind: ExerciseKind, repRange: RepRange, targetRPE: number): Suggestion {
  const aim = middle(repRange);
  const exact = isFixed(repRange) ? '' : '~';
  const effort = targetRPE >= 10 ? 'hasta el fallo' : targetRPE >= 9 ? 'cerca del fallo' : 'con esfuerzo';
  const hint =
    kind === 'weighted'
      ? `Primera vez: elige un peso con el que llegues a ${exact}${aim} reps ${effort}.`
      : kind === 'timed'
        ? `Primera vez: aguanta ${exact}${aim} s ${effort}.`
        : `Primera vez: haz ${exact}${aim} reps ${effort}.`;
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

