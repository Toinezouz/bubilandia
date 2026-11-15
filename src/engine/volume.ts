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
