import { DEFAULT_TARGET_RPE } from '../engine/rpe.ts';
import { plannedWeeklyTargets } from '../engine/volume.ts';
import { MUSCLES, SETTINGS_ID, type Exercise, type Muscle, type SessionTemplate, type Settings, type WeeklySetTarget } from '../db/types.ts';
import { SEED_EXERCISES } from './exercises.ts';
import { SEED_TEMPLATES } from './templates.ts';

/** Bump when the seeded program changes in a way existing installs should receive. */
export const SEED_VERSION = 1;

/**
 * Weekly set targets that follow the program (each session once a week): minimum = base
 * sets, maximum = with the bonus sets. The program is glute-focused, so the targets say what
 * it plans for each muscle instead of a generic 8-10 that would stay "below" all the time.
 */
export function targetsFromProgram(
  templates: ReadonlyArray<SessionTemplate>,
  exercises: ReadonlyArray<Exercise>,
): Record<Muscle, WeeklySetTarget> {
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const lines = templates.flatMap((t) =>
    t.items.flatMap((i) => {
      const e = byId.get(i.exerciseId);
      return e
        ? [{ primaryMuscle: e.primaryMuscle, secondaryMuscle: e.secondaryMuscle, baseSets: i.baseSets, extraSets: i.optionalExtraSets }]
        : [];
    }),
  );
  return plannedWeeklyTargets(lines, MUSCLES) as Record<Muscle, WeeklySetTarget>;
}

/** The generic targets used up to 0.5 (glúteos 15, the others 8-10). */
export function legacyWeeklyTargets(): Record<Muscle, WeeklySetTarget> {
  const targets = {} as Record<Muscle, WeeklySetTarget>;
  for (const muscle of MUSCLES) targets[muscle] = { min: 8, max: 10 };
  targets.glutes = { min: 15, max: 15 };
  return targets;
}

export function defaultSettings(): Settings {
  return {
    id: SETTINGS_ID,
    targetRPE: DEFAULT_TARGET_RPE,
    weeklySetTargets: targetsFromProgram(SEED_TEMPLATES, SEED_EXERCISES),
    soundEnabled: true,
    tenSecondBeep: true,
    warmupEnabled: true,
    lastExportAt: null,
    backupReminderDismissedAt: null,
    seedVersion: SEED_VERSION,
  };
}
