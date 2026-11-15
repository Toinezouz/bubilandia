/**
 * Workout persistence. Every user action is one small write, so a reload, an app kill or a
 * reboot resumes exactly where she was (§5). Business rules come from the engine.
 */

import { adjustRest, prefillForSet, suggestNext, type PerformedSet, type Suggestion } from '../engine/index.ts';
import { newId } from '../shared/id.ts';
import type { AppDatabase } from './database.ts';
import {
  SETTINGS_ID,
  type ActiveRest,
  type Exercise,
  type PerformedExercise,
  type SessionTemplate,
  type SetEntry,
  type TemplateItem,
  type Workout,
} from './types.ts';

export async function getActiveWorkout(db: AppDatabase): Promise<Workout | undefined> {
  return db.workouts.where('status').equals('in_progress').first();
}

export interface LastPerformance {
  workout: Workout;
  sets: PerformedSet[];
}

/**
 * Working sets from the most recent completed, non-deload workout where this exercise was
 * actually done (not skipped, at least one completed set). Null if there is none.
 */
export async function lastPerformance(
  db: AppDatabase,
  exerciseId: string,
  excludeWorkoutId?: string,
): Promise<LastPerformance | null> {
  const performed = await db.performedExercises.where('exerciseId').equals(exerciseId).toArray();
  const workouts = await db.workouts.bulkGet(performed.map((p) => p.workoutId));

  const candidates = performed
    .map((pe, i) => ({ pe, workout: workouts[i] }))
    .filter(
      (c): c is { pe: PerformedExercise; workout: Workout } =>
        !!c.workout &&
        c.workout.status === 'done' &&
        !c.workout.isDeload &&
        !c.pe.skipped &&
        c.workout.id !== excludeWorkoutId,
    )
    .sort((a, b) => b.workout.startedAt - a.workout.startedAt);

  for (const { pe, workout } of candidates) {
    const sets = (await db.sets.where('performedExerciseId').equals(pe.id).sortBy('index'))
      .filter((s) => !s.isWarmup && s.completedAt !== null && s.reps !== null)
      .map((s) => ({ weight: s.weight, reps: s.reps!, rpe: s.rpe }));
    if (sets.length > 0) return { workout, sets };
  }
  return null;
}

/** The engine's suggestion for one template item, from the exercise's history. */
export async function suggestionFor(
  db: AppDatabase,
  exercise: Exercise,
  item: Pick<TemplateItem, 'repMin' | 'repMax' | 'targetRPE'>,
  globalTargetRPE: number,
  excludeWorkoutId?: string,
): Promise<{ suggestion: Suggestion; last: LastPerformance | null }> {
  const last = await lastPerformance(db, exercise.id, excludeWorkoutId);
  const suggestion = suggestNext({
    kind: exercise.kind,
    repRange: { min: item.repMin, max: item.repMax },
    increment: exercise.increment,
    targetRPE: item.targetRPE ?? globalTargetRPE,
    lastSets: last?.sets ?? [],
  });
  return { suggestion, last };
}

const ALL_TABLES = (db: AppDatabase) => [
  db.exercises,
  db.sessionTemplates,
  db.workouts,
  db.performedExercises,
  db.sets,
  db.settings,
];

/** Creates the workout with every exercise and its pre-filled sets. Returns its id. */
export async function startWorkout(db: AppDatabase, templateId: string, now: number): Promise<string> {
  return db.transaction('rw', ALL_TABLES(db), async () => {
    if (await getActiveWorkout(db)) throw new Error('A workout is already in progress');
    const template = await db.sessionTemplates.get(templateId);
    if (!template) throw new Error(`Unknown template ${templateId}`);
    const settings = await db.settings.get(SETTINGS_ID);
    const targetRPE = settings?.targetRPE ?? 8;

    const workout: Workout = {
      id: newId(),
      templateId,
      startedAt: now,
      endedAt: null,
      readiness: null,
      notes: '',
      isDeload: false,
      status: 'in_progress',
      activeRest: null,
    };
    await db.workouts.add(workout);

    for (const item of [...template.items].sort((a, b) => a.order - b.order)) {
      const exercise = await db.exercises.get(item.exerciseId);
      if (!exercise) continue;
      const { suggestion } = await suggestionFor(db, exercise, item, targetRPE);
      const pe: PerformedExercise = {
        id: newId(),
        workoutId: workout.id,
        exerciseId: exercise.id,
        templateExerciseId: exercise.id,
        order: item.order,
        skipped: false,
        note: '',
      };
      await db.performedExercises.add(pe);
      await db.sets.bulkAdd(
        Array.from({ length: item.baseSets }, (_, index) => {
          const prefill = prefillForSet(suggestion, index);
          return {
            id: newId(),
            performedExerciseId: pe.id,
            index,
            isWarmup: false,
            weight: prefill.weight,
            reps: prefill.reps,
            rpe: null,
            completedAt: null,
            suggestedWeight: suggestion.weight,
            suggestedReps: prefill.reps,
          } satisfies SetEntry;
        }),
      );
    }
    return workout.id;
  });
}

/** Saves the draft values of a row (each +/- tap, each keyboard edit). */
export async function updateSetValues(
  db: AppDatabase,
  setId: string,
  values: Partial<Pick<SetEntry, 'weight' | 'reps' | 'rpe'>>,
): Promise<void> {
  await db.sets.update(setId, values);
}

/**
 * "Hecho" + RPE: the set becomes a completed working set. Weight and reps are the values
 * already saved by the row (every change is persisted), so only RPE and time are added.
 */
export async function completeSet(db: AppDatabase, setId: string, rpe: number, now: number): Promise<void> {
  await db.transaction('rw', db.sets, async () => {
    const set = await db.sets.get(setId);
    if (!set) throw new Error(`Unknown set ${setId}`);
    if (set.reps === null || set.reps <= 0) throw new Error('A completed set needs reps');
    await db.sets.update(setId, { rpe, completedAt: set.completedAt ?? now });

    // Calibration: carry the load she chose into the following sets left empty.
    if (set.weight !== null) {
      await db.sets
        .where('performedExerciseId')
        .equals(set.performedExerciseId)
        .filter((s) => s.index > set.index && s.completedAt === null && s.weight === null && !s.isWarmup)
        .modify({ weight: set.weight });
    }
  });
}

/** Appends a set pre-filled like the previous one. */
export async function addSet(db: AppDatabase, performedExerciseId: string): Promise<string> {
  return db.transaction('rw', db.sets, async () => {
    const sets = await db.sets.where('performedExerciseId').equals(performedExerciseId).sortBy('index');
    const previous = sets.filter((s) => !s.isWarmup).at(-1);
    const id = newId();
    await db.sets.add({
      id,
      performedExerciseId,
      index: (sets.at(-1)?.index ?? -1) + 1,
      isWarmup: false,
      weight: previous?.weight ?? null,
      reps: previous?.suggestedReps ?? previous?.reps ?? null,
      rpe: null,
      completedAt: null,
      suggestedWeight: previous?.suggestedWeight ?? null,
      suggestedReps: previous?.suggestedReps ?? null,
    });
    return id;
  });
}

/** Deletes a set and renumbers the remaining ones. */
export async function removeSet(db: AppDatabase, setId: string): Promise<void> {
  await db.transaction('rw', db.sets, async () => {
    const set = await db.sets.get(setId);
    if (!set) return;
    await db.sets.delete(setId);
    const rest = await db.sets.where('performedExerciseId').equals(set.performedExerciseId).sortBy('index');
    await Promise.all(rest.map((s, index) => (s.index === index ? null : db.sets.update(s.id, { index }))));
  });
}

export async function setExerciseSkipped(db: AppDatabase, performedExerciseId: string, skipped: boolean): Promise<void> {
  await db.performedExercises.update(performedExerciseId, { skipped });
}

export async function setExerciseNote(db: AppDatabase, performedExerciseId: string, note: string): Promise<void> {
  await db.performedExercises.update(performedExerciseId, { note });
}

/** Ends the workout; sets never marked "Hecho" are dropped so they never count anywhere. */
export async function finishWorkout(db: AppDatabase, workoutId: string, now: number, notes?: string): Promise<void> {
  await db.transaction('rw', [db.workouts, db.performedExercises, db.sets], async () => {
    const peIds = await db.performedExercises.where('workoutId').equals(workoutId).primaryKeys();
    await db.sets.where('performedExerciseId').anyOf(peIds).filter((s) => s.completedAt === null).delete();
    await db.workouts.update(workoutId, {
      status: 'done',
      endedAt: now,
      activeRest: null,
      ...(notes !== undefined ? { notes } : {}),
    });
  });
}

/** Persists the running rest timer (or clears it) so it survives a reload. */
export async function setActiveRest(db: AppDatabase, workoutId: string, rest: ActiveRest | null): Promise<void> {
  await db.workouts.update(workoutId, { activeRest: rest });
}

/**
 * −15 s / +15 s applied to the value stored now (not the one last rendered), so quick
 * repeated taps all count.
 */
export async function adjustActiveRest(db: AppDatabase, workoutId: string, deltaSeconds: number, now: number): Promise<void> {
  await db.transaction('rw', db.workouts, async () => {
    const rest = (await db.workouts.get(workoutId))?.activeRest;
    if (rest) await db.workouts.update(workoutId, { activeRest: adjustRest(rest, deltaSeconds, now) });
  });
}

export async function abandonWorkout(db: AppDatabase, workoutId: string, now: number): Promise<void> {
  await db.workouts.update(workoutId, { status: 'abandoned', endedAt: now, activeRest: null });
}

/** Everything the workout screen shows, in one read. */
export interface WorkoutView {
  workout: Workout;
  template: SessionTemplate | undefined;
  exercises: Array<{
    performed: PerformedExercise;
    exercise: Exercise;
    item: TemplateItem | undefined;
    sets: SetEntry[];
  }>;
}

export async function loadWorkoutView(db: AppDatabase, workoutId: string): Promise<WorkoutView | null> {
  const workout = await db.workouts.get(workoutId);
  if (!workout) return null;
  const template = await db.sessionTemplates.get(workout.templateId);
  const performed = await db.performedExercises.where('workoutId').equals(workoutId).sortBy('order');
  const exercises = await db.exercises.bulkGet(performed.map((p) => p.exerciseId));
  const sets = await db.sets.where('performedExerciseId').anyOf(performed.map((p) => p.id)).toArray();

  return {
    workout,
    template,
    exercises: performed.flatMap((pe, i) => {
      const exercise = exercises[i];
      if (!exercise) return [];
      return [
        {
          performed: pe,
          exercise,
          item: template?.items.find((it) => it.order === pe.order),
          sets: sets.filter((s) => s.performedExerciseId === pe.id).sort((a, b) => a.index - b.index),
        },
      ];
    }),
  };
}
