/**
 * Personal records (§6.2 summary, §6.4): best e1RM, and best load for a given number of reps.
 * Only for weighted exercises; the caller passes working sets only (no warm-ups).
 */

import { estimateE1RM } from './e1rm.ts';
import type { PerformedSet } from './types.ts';

export type PersonalRecord =
  | { type: 'e1rm'; weight: number; reps: number; e1rm: number }
  /** Heavier than anything done before for at least this many reps. */
  | { type: 'weight_for_reps'; weight: number; reps: number };

const EPSILON = 0.01;

type LoadedSet = PerformedSet & { weight: number };
const loaded = (sets: ReadonlyArray<PerformedSet>): LoadedSet[] =>
  sets.filter((s): s is LoadedSet => s.weight !== null && s.weight > 0 && s.reps > 0);

/**
 * Records beaten today compared with all previous sessions of the exercise.
 * Nothing on the very first session (everything would be a "record").
 * At most one record of each type per exercise: the most meaningful one.
 */
export function findRecords(previous: ReadonlyArray<PerformedSet>, current: ReadonlyArray<PerformedSet>): PersonalRecord[] {
  const before = loaded(previous);
  const today = loaded(current);
  if (before.length === 0 || today.length === 0) return [];

  const records: PersonalRecord[] = [];

  const e1 = (s: LoadedSet) => estimateE1RM(s.weight, s.reps, s.rpe);
  const bestBefore = Math.max(...before.map(e1));
  const bestToday = today.reduce((best, s) => (e1(s) > e1(best) ? s : best));
  if (e1(bestToday) > bestBefore + EPSILON) {
    records.push({ type: 'e1rm', weight: bestToday.weight, reps: bestToday.reps, e1rm: e1(bestToday) });
  }

  // Heavier than the heaviest previous set done for at least as many reps. Rep counts never
  // reached before are not compared (no reference), to avoid noisy "records".
  let bestRep: LoadedSet | null = null;
  for (const s of today) {
    const comparable = before.filter((p) => p.reps >= s.reps);
    if (comparable.length === 0) continue;
    const previousMax = Math.max(...comparable.map((p) => p.weight));
    if (s.weight > previousMax + EPSILON) {
      if (!bestRep || s.weight > bestRep.weight || (s.weight === bestRep.weight && s.reps > bestRep.reps)) bestRep = s;
    }
  }
  if (bestRep) records.push({ type: 'weight_for_reps', weight: bestRep.weight, reps: bestRep.reps });

  return records;
}

/** Tonnage: Σ load × reps over sets with a load (reps per side counted once). */
export function totalVolume(sets: ReadonlyArray<PerformedSet>): number {
  return loaded(sets).reduce((sum, s) => sum + s.weight * s.reps, 0);
}
