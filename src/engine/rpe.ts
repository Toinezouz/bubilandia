/** RPE scale (§7.1). RIR ("repeticiones en reserva") = 10 − RPE. */

export const RPE_VALUES = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10] as const;
export type Rpe = (typeof RPE_VALUES)[number];

/** Spanish labels, highest effort first (display order of the picker). */
export const RPE_LABELS: ReadonlyArray<{ rpe: Rpe; label: string }> = [
  { rpe: 10, label: 'Máximo: no podía hacer ni una más' },
  { rpe: 9.5, label: 'Quizá 1 más, no seguro' },
  { rpe: 9, label: 'Me quedaba 1' },
  { rpe: 8.5, label: 'Me quedaban 1-2' },
  { rpe: 8, label: 'Me quedaban 2' },
  { rpe: 7.5, label: 'Me quedaban 2-3' },
  { rpe: 7, label: 'Me quedaban 3' },
  { rpe: 6, label: '4 o más, fácil' },
];

/**
 * Bodybuilding, not powerlifting: sets are taken close to failure (≈ 1 rep in reserve) while
 * staying inside the program's rep ranges. She still logs the real RPE after every set.
 */
export const DEFAULT_TARGET_RPE = 9;
/** Target zone: close to failure (0 to 1 rep in reserve). */
export const TARGET_ZONE = { min: 9, max: 10 } as const;

export function rir(rpe: number): number {
  return 10 - rpe;
}

/**
 * Mean of the known RPE values. Missing values are ignored; if none is known,
 * `fallback` is returned (callers pass the target RPE: "as planned").
 */
export function averageRpe(rpes: ReadonlyArray<number | null>, fallback: number): number {
  const known = rpes.filter((r): r is number => r !== null);
  if (known.length === 0) return fallback;
  return known.reduce((sum, r) => sum + r, 0) / known.length;
}
