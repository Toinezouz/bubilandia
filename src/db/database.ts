import Dexie, { type EntityTable } from 'dexie';
import { COMPOUND_IDS } from '../seed/exercises.ts';
import type {
  Exercise,
  PerformedExercise,
  SessionTemplate,
  SetEntry,
  Settings,
  Workout,
} from './types.ts';

export const DB_NAME = 'bubilandia-fuerza';

/**
 * Current schema version. Bump it and add a new `this.version(n)` block (never edit an old one)
 * whenever indexes change or data must be migrated. Exports record this number (§6.5).
 */
export const SCHEMA_VERSION = 2;

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
  }
}

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
