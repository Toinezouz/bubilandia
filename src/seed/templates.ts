import type { SessionTemplate, TemplateItem } from '../db/types.ts';

/** Program from §4: 4 sessions in rotation A → B → C → D → A… */

/**
 * Fixed number of reps per exercise (seconds for the plank), chosen inside the program's
 * original ranges. Each set is taken close to failure (target RPE 9, one rep in reserve).
 *
 * Why these numbers (see README, "Repeticiones fijas"):
 * - muscle growth is similar from ~6 to ~30 reps per set when sets end close to failure
 *   (Schoenfeld et al. 2017, 2021), so the number is chosen for practical reasons;
 * - RPE / reps-in-reserve ratings are more accurate on shorter sets taken close to failure
 *   (Zourdos et al. 2021; Remmert et al. 2023) → no 18-20 rep sets;
 * - heavy multi-joint lifts (hip thrust, Romanian deadlift): 8 reps, less systemic fatigue
 *   and technique breakdown at the end of long sets;
 * - other multi-joint lifts (presses, rows, pulldowns): 10;
 * - single-joint exercises: 12;
 * - abducción and lateral raises: 15, because their load steps (2,5 kg / 1 kg) are large
 *   compared with the load: more reps make each step a smaller jump.
 * The original ranges are kept here for reference and for the migration of existing data.
 */
export const FIXED_REPS: Readonly<Record<string, { reps: number; from: [number, number] }>> = {
  'hip-thrust': { reps: 8, from: [6, 10] },
  'seated-leg-press': { reps: 10, from: [8, 12] },
  'leg-extension': { reps: 12, from: [10, 15] },
  'hip-abduction': { reps: 15, from: [12, 20] },
  'chest-press': { reps: 10, from: [8, 12] },
  'lat-pulldown': { reps: 10, from: [8, 12] },
  'seated-shoulder-press': { reps: 10, from: [8, 12] },
  row: { reps: 10, from: [8, 12] },
  'face-pull': { reps: 12, from: [12, 15] },
  'biceps-curl': { reps: 12, from: [10, 15] },
  'cable-triceps': { reps: 12, from: [10, 15] },
  'romanian-deadlift': { reps: 8, from: [6, 10] },
  'single-leg-press': { reps: 10, from: [8, 12] },
  'leg-curl': { reps: 12, from: [10, 15] },
  'back-extension': { reps: 12, from: [10, 15] },
  'cable-kickback': { reps: 12, from: [12, 15] },
  'hip-adduction': { reps: 12, from: [12, 15] },
  'single-arm-machine-row': { reps: 10, from: [8, 12] },
  pullover: { reps: 12, from: [10, 15] },
  'lateral-raise': { reps: 15, from: [12, 20] },
  'reverse-pec-deck': { reps: 12, from: [12, 15] },
  plank: { reps: 40, from: [30, 45] },
  'machine-crunch': { reps: 12, from: [10, 15] },
};

/**
 * Fixed target for a range that is not in the table (an exercise she added, or a range she
 * edited): the lower third of the range, where sets stay accurate and loads progress.
 */
export function fixedRepsFor(exerciseId: string, repMin: number, repMax: number): number {
  const known = FIXED_REPS[exerciseId];
  if (known && known.from[0] === repMin && known.from[1] === repMax) return known.reps;
  return repMin + Math.round((repMax - repMin) / 3);
}

/**
 * One template line. `sets` is "3" or "2-3" (2 planned + 1 optional bonus set, §7.5).
 * Fixed reps: repMin = repMax (seconds for timed exercises).
 */
function item(order: number, exerciseId: string, sets: '2' | '3' | '2-3', restSeconds: number): TemplateItem {
  const reps = FIXED_REPS[exerciseId]!.reps;
  return {
    exerciseId,
    order,
    baseSets: sets === '3' ? 3 : 2,
    optionalExtraSets: sets === '2-3' ? 1 : 0,
    repMin: reps,
    repMax: reps,
    restSeconds,
    targetRPE: null,
  };
}

export const SEED_TEMPLATES: SessionTemplate[] = [
  {
    id: 'pierna-a',
    name: 'Pierna A',
    code: 'A',
    order: 0,
    isLegDay: true,
    items: [
      item(0, 'hip-thrust', '3', 150),
      item(1, 'seated-leg-press', '3', 150),
      item(2, 'leg-extension', '3', 90),
      item(3, 'hip-abduction', '3', 90),
    ],
  },
  {
    id: 'superior-a',
    name: 'Tren superior A',
    code: 'B',
    order: 1,
    isLegDay: false,
    items: [
      item(0, 'chest-press', '3', 120),
      item(1, 'lat-pulldown', '3', 120),
      item(2, 'seated-shoulder-press', '3', 120),
      item(3, 'row', '3', 120),
      item(4, 'face-pull', '3', 75),
      item(5, 'biceps-curl', '2-3', 90),
      item(6, 'cable-triceps', '2-3', 90),
    ],
  },
  {
    id: 'pierna-b',
    name: 'Pierna B',
    code: 'C',
    order: 2,
    isLegDay: true,
    items: [
      item(0, 'romanian-deadlift', '3', 150),
      item(1, 'single-leg-press', '3', 90),
      item(2, 'leg-curl', '3', 90),
      item(3, 'back-extension', '3', 90),
      item(4, 'cable-kickback', '2-3', 60),
      item(5, 'hip-adduction', '2-3', 60),
    ],
  },
  {
    id: 'superior-b',
    name: 'Tren superior B + core',
    code: 'D',
    order: 3,
    isLegDay: false,
    items: [
      item(0, 'single-arm-machine-row', '3', 90),
      item(1, 'pullover', '2-3', 90),
      item(2, 'lateral-raise', '3', 60),
      item(3, 'reverse-pec-deck', '3', 60),
      item(4, 'biceps-curl', '2', 90),
      item(5, 'cable-triceps', '2', 90),
      item(6, 'plank', '3', 60),
      item(7, 'machine-crunch', '3', 60),
    ],
  },
];
