import Dexie, { type EntityTable } from 'dexie';
import { DEFAULT_TARGET_RPE } from '../engine/rpe.ts';
import { COMPOUND_IDS } from '../seed/exercises.ts';
import { legacyWeeklyTargets, targetsFromProgram } from '../seed/settings.ts';
import { fixedRepsFor } from '../seed/templates.ts';
import type {
  Exercise,
  PerformedExercise,
  SessionTemplate,
  SetEntry,
  Settings,
  TemplateItem,
  Workout,
} from './types.ts';

export const DB_NAME = 'bubilandia-fuerza';

/**
 * Current schema version. Bump it and add a new `this.version(n)` block (never edit an old one)
 * whenever indexes change or data must be migrated. Exports record this number (§6.5).
 */
export const SCHEMA_VERSION = 5;

export class AppDatabase extends Dexie {
  exercises!: EntityTable<Exercise, 'id'>;
  sessionTemplates!: EntityTable<SessionTemplate, 'id'>;
  workouts!: EntityTable<Workout, 'id'>;
  performedExercises!: EntityTable<PerformedExercise, 'id'>;
  sets!: EntityTable<SetEntry, 'id'>;
  settings!: EntityTable<Settings, 'id'>;

  constructor(name: string = DB_NAME) {
    super(name);

    // Only indexed fields are listed; other fields are stored but not indexed.
    this.version(1).stores({
      exercises: 'id',
      sessionTemplates: 'id, order',
      workouts: 'id, templateId, startedAt, status, [templateId+startedAt]',
      performedExercises: 'id, workoutId, exerciseId, [workoutId+order]',
      sets: 'id, performedExerciseId, completedAt',
      settings: 'id',
    });

    // v2: exercises get `isCompound` (warm-up before the first compound exercise).
    // Same indexes; existing installs get the flag from the program definition.
    this.version(2).stores({}).upgrade(async (tx) => {
      await tx
        .table('exercises')
        .toCollection()
        .modify((exercise: Partial<Exercise>) => {
          if (exercise.isCompound === undefined) exercise.isCompound = COMPOUND_IDS.has(exercise.id ?? '');
        });
    });

    // v3: bodybuilding close to failure. The old default target (RPE 8, two reps in reserve)
    // becomes RPE 9 (one in reserve); a target she chose herself is kept.
    this.version(3).stores({}).upgrade(async (tx) => {
      await tx
        .table('settings')
        .toCollection()
        .modify((settings: Partial<Settings>) => {
          if (settings.targetRPE === undefined || settings.targetRPE === LEGACY_DEFAULT_TARGET_RPE) {
            settings.targetRPE = DEFAULT_TARGET_RPE;
          }
        });
    });

    // v4: fixed number of reps per exercise instead of rep ranges (see seed/templates.ts).
    this.version(4).stores({}).upgrade(async (tx) => {
      await tx
        .table('sessionTemplates')
        .toCollection()
        .modify((template: SessionTemplate) => {
          template.items = toFixedReps(template.items);
        });
    });

    // v5: weekly set targets follow the program (glute-focused) instead of a generic 8-10.
    // Targets she changed herself are kept.
    this.version(5).stores({}).upgrade(async (tx) => {
      const templates = (await tx.table('sessionTemplates').toArray()) as SessionTemplate[];
      const exercises = (await tx.table('exercises').toArray()) as Exercise[];
      await tx
        .table('settings')
        .toCollection()
        .modify((settings: Settings) => {
          if (hasLegacyTargets(settings)) settings.weeklySetTargets = targetsFromProgram(templates, exercises);
        });
    });
  }
}

/** v4: every template line gets a fixed number of reps (repMin = repMax). History is untouched. */
export function toFixedReps(items: TemplateItem[]): TemplateItem[] {
  return items.map((item) => {
    if (item.repMin === item.repMax) return item;
    const reps = fixedRepsFor(item.exerciseId, item.repMin, item.repMax);
    return { ...item, repMin: reps, repMax: reps };
  });
}

/** True when the weekly targets are still the generic ones of versions ≤ 0.5. */
export function hasLegacyTargets(settings: Pick<Settings, 'weeklySetTargets'>): boolean {
  const legacy = legacyWeeklyTargets();
  return Object.entries(legacy).every(([m, t]) => {
    const current = settings.weeklySetTargets?.[m as keyof typeof legacy];
    return current !== undefined && current.min === t.min && current.max === t.max;
  });
}

/** Default target RPE up to schema v2. */
export const LEGACY_DEFAULT_TARGET_RPE = 8;

/** All tables, in the order used by export/import. */
export const TABLE_NAMES = [
  'exercises',
  'sessionTemplates',
  'workouts',
  'performedExercises',
  'sets',
  'settings',
] as const;

export const db = new AppDatabase();
