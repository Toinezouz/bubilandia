/**
 * Weekly volume per muscle group (§4, §6.1, §6.4): each working set counts 1 for the
 * primary muscle and 0.5 for the secondary one. Warm-ups must not be passed in.
 */

export interface VolumeEntry {
  primaryMuscle: string;
  secondaryMuscle: string | null;
  /** Number of completed working sets for that exercise. */
  sets: number;
}

export function setsPerMuscle(entries: ReadonlyArray<VolumeEntry>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const e of entries) {
    if (e.sets <= 0) continue;
    totals[e.primaryMuscle] = (totals[e.primaryMuscle] ?? 0) + e.sets;
    if (e.secondaryMuscle) totals[e.secondaryMuscle] = (totals[e.secondaryMuscle] ?? 0) + e.sets * 0.5;
  }
  return totals;
}

export type VolumeStatus = 'below' | 'within' | 'above';

export function volumeStatus(sets: number, target: { min: number; max: number }): VolumeStatus {
  if (sets < target.min) return 'below';
  if (sets > target.max) return 'above';
  return 'within';
}

/**
 * Keeps an edited weekly target coherent: whole numbers, 0 ≤ min ≤ max ≤ 40. The bound she
 * just changed wins: raising the minimum above the maximum pushes the maximum up, and
 * lowering the maximum below the minimum pulls the minimum down.
 */
export function normalizeTarget(target: { min: number; max: number }, changed: 'min' | 'max'): { min: number; max: number } {
  const clamp = (n: number) => Math.min(40, Math.max(0, Math.round(n)));
  let min = clamp(target.min);
  let max = clamp(target.max);
  if (min > max) {
    if (changed === 'min') max = min;
    else min = max;
  }
  return { min, max };
}

export interface PlannedLine {
  primaryMuscle: string;
  secondaryMuscle: string | null;
  /** Sets always planned. */
  baseSets: number;
  /** Optional bonus sets (good days only). */
  extraSets: number;
}

/**
 * Weekly targets that match what the program plans, each session once a week: the minimum is
 * the base sets (a normal week), the maximum adds the bonus sets (a good week). Secondary
 * muscles count half, like in the weekly volume. Muscles the program does not train get 0-0.
 */
export function plannedWeeklyTargets(lines: ReadonlyArray<PlannedLine>, muscles: ReadonlyArray<string>): Record<string, { min: number; max: number }> {
  const base: Record<string, number> = {};
  const extra: Record<string, number> = {};
  const add = (bucket: Record<string, number>, muscle: string | null, sets: number) => {
    if (muscle) bucket[muscle] = (bucket[muscle] ?? 0) + sets;
  };
  for (const l of lines) {
    add(base, l.primaryMuscle, l.baseSets);
    add(base, l.secondaryMuscle, l.baseSets * 0.5);
    add(extra, l.primaryMuscle, l.extraSets);
    add(extra, l.secondaryMuscle, l.extraSets * 0.5);
  }
  return Object.fromEntries(
    muscles.map((m) => {
      const b = base[m] ?? 0;
      const min = Math.floor(b);
      const max = Math.max(min, Math.ceil(b + (extra[m] ?? 0)));
      return [m, { min, max }];
    }),
  );
}
