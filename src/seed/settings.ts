import { MUSCLES, SETTINGS_ID, type Muscle, type Settings, type WeeklySetTarget } from '../db/types.ts';

/** Bump when the seeded program changes in a way existing installs should receive. */
export const SEED_VERSION = 1;

/** §6.4: glúteos 15 sets/week, the others 8-10. */
function defaultWeeklyTargets(): Record<Muscle, WeeklySetTarget> {
  const targets = {} as Record<Muscle, WeeklySetTarget>;
  for (const muscle of MUSCLES) targets[muscle] = { min: 8, max: 10 };
  targets.glutes = { min: 15, max: 15 };
  return targets;
}

export function defaultSettings(): Settings {
  return {
    id: SETTINGS_ID,
    targetRPE: 8,
    weeklySetTargets: defaultWeeklyTargets(),
    soundEnabled: true,
    tenSecondBeep: true,
    warmupEnabled: true,
    lastExportAt: null,
    backupReminderDismissedAt: null,
    seedVersion: SEED_VERSION,
  };
}
