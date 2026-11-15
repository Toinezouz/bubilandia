import type { SessionTemplate, TemplateItem } from '../db/types.ts';

/** Program from §4: 4 sessions in rotation A → B → C → D → A… */

/**
 * One template line. `sets` is "3" or "2-3" (2 planned + 1 optional bonus set, §7.5).
 * For timed exercises reps are seconds.
 */
function item(
  order: number,
  exerciseId: string,
  sets: '2' | '3' | '2-3',
  repMin: number,
  repMax: number,
  restSeconds: number,
): TemplateItem {
  return {
    exerciseId,
    order,
    baseSets: sets === '3' ? 3 : 2,
    optionalExtraSets: sets === '2-3' ? 1 : 0,
    repMin,
    repMax,
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
      item(0, 'hip-thrust', '3', 6, 10, 150),
      item(1, 'seated-leg-press', '3', 8, 12, 150),
      item(2, 'leg-extension', '3', 10, 15, 90),
      item(3, 'hip-abduction', '3', 12, 20, 90),
    ],
  },
  {
    id: 'superior-a',
    name: 'Tren superior A',
    code: 'B',
    order: 1,
    isLegDay: false,
    items: [
      item(0, 'chest-press', '3', 8, 12, 120),
      item(1, 'lat-pulldown', '3', 8, 12, 120),
      item(2, 'seated-shoulder-press', '3', 8, 12, 120),
      item(3, 'row', '3', 8, 12, 120),
      item(4, 'face-pull', '3', 12, 15, 75),
      item(5, 'biceps-curl', '2-3', 10, 15, 90),
      item(6, 'cable-triceps', '2-3', 10, 15, 90),
    ],
  },
  {
    id: 'pierna-b',
    name: 'Pierna B',
    code: 'C',
    order: 2,
    isLegDay: true,
    items: [
      item(0, 'romanian-deadlift', '3', 6, 10, 150),
      item(1, 'single-leg-press', '3', 8, 12, 90),
      item(2, 'leg-curl', '3', 10, 15, 90),
      item(3, 'back-extension', '3', 10, 15, 90),
      item(4, 'cable-kickback', '2-3', 12, 15, 60),
      item(5, 'hip-adduction', '2-3', 12, 15, 60),
    ],
  },
  {
    id: 'superior-b',
    name: 'Tren superior B + core',
    code: 'D',
    order: 3,
    isLegDay: false,
    items: [
      item(0, 'single-arm-machine-row', '3', 8, 12, 90),
      item(1, 'pullover', '2-3', 10, 15, 90),
      item(2, 'lateral-raise', '3', 12, 20, 60),
      item(3, 'reverse-pec-deck', '3', 12, 15, 60),
      item(4, 'biceps-curl', '2', 10, 15, 90),
      item(5, 'cable-triceps', '2', 10, 15, 90),
      item(6, 'plank', '3', 30, 45, 60),
      item(7, 'machine-crunch', '3', 10, 15, 60),
    ],
  },
];
