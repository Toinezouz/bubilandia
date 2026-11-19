/**
 * Workout persistence. Every user action is one small write, so a reload, an app kill or a
 * reboot resumes exactly where she was (§5). Business rules come from the engine.
 */

import {
  DEFAULT_TARGET_RPE,
  DELOAD_SESSIONS,
  adjustRest,
  deloadSets,
  lightSessionWeight,
  prefillForSet,
  suggestNext,
  warmupSets,
  type PerformedSet,
  type Suggestion,
} from '../engine/index.ts';
import { newId } from '../shared/id.ts';
import type { AppDatabase } from './database.ts';
import {
  SETTINGS_ID,
  type ActiveRest,
  type Exercise,
  type PerformedExercise,
  type Readiness,
  type SessionTemplate,
  type SetEntry,
  type TemplateItem,
  type Workout,
} from './types.ts';

export async function getActiveWorkout(db: AppDatabase): Promise<Workout | undefined> {
  return db.workouts.where('status').equals('in_progress').first();
}

/**
 * Sessions done on purpose with lighter loads say nothing about her real level: deload weeks,
 * light sessions accepted on a bad day and the −10 % session after a break are all ignored by
 * the progression (next suggestion, form of the day, stagnation). They stay in the history.
 */
export function countsForProgression(workout: Workout): boolean {
  return workout.status === 'done' && !workout.isDeload && !workout.lightSession && !workout.reducedLoads;
}

export interface LastPerformance {
  workout: Workout;
  sets: PerformedSet[];
}

/**
 * Working sets from the most recent completed workout that counts for progression, where
 * this exercise was actually done (not skipped, at least one completed set). Null if none.
 */
export async function lastPerformance(
  db: AppDatabase,
  exerciseId: string,
  excludeWorkoutId?: string,
): Promise<LastPerformance | null> {
  return (await recentPerformances(db, exerciseId, excludeWorkoutId, 1))[0] ?? null;
}

/** The `count` most recent sessions that count for progression (see lastPerformance), newest first. */
export async function recentPerformances(
  db: AppDatabase,
  exerciseId: string,
  excludeWorkoutId: string | undefined,
  count: number,
): Promise<LastPerformance[]> {
  const performed = await db.performedExercises.where('exerciseId').equals(exerciseId).toArray();
  const workouts = await db.workouts.bulkGet(performed.map((p) => p.workoutId));

  const candidates = performed
    .map((pe, i) => ({ pe, workout: workouts[i] }))
    .filter(
      (c): c is { pe: PerformedExercise; workout: Workout } =>
        !!c.workout &&
        countsForProgression(c.workout) &&
        !c.pe.skipped &&
        c.workout.id !== excludeWorkoutId,
    )
    .sort((a, b) => b.workout.startedAt - a.workout.startedAt);

  const found: LastPerformance[] = [];
  for (const { pe, workout } of candidates) {
    const sets = (await db.sets.where('performedExerciseId').equals(pe.id).sortBy('index'))
      .filter((s) => !s.isWarmup && s.completedAt !== null && s.reps !== null && s.reps > 0)
      .map((s) => ({ weight: s.weight, reps: s.reps!, rpe: s.rpe }));
    if (sets.length > 0) found.push({ workout, sets });
    if (found.length >= count) break;
  }
  return found;
}

/** The engine's suggestion for one template item, from the exercise's history. */
export async function suggestionFor(
  db: AppDatabase,
  exercise: Exercise,
  item: Pick<TemplateItem, 'repMin' | 'repMax' | 'targetRPE'>,
  globalTargetRPE: number,
  excludeWorkoutId?: string,
): Promise<{ suggestion: Suggestion; last: LastPerformance | null }> {
  const [last, previous] = await recentPerformances(db, exercise.id, excludeWorkoutId, 2);
  const suggestion = suggestNext({
    kind: exercise.kind,
    repRange: { min: item.repMin, max: item.repMax },
    increment: exercise.increment,
    targetRPE: item.targetRPE ?? globalTargetRPE,
    lastSets: last?.sets ?? [],
    previousSets: previous?.sets,
  });
  return { suggestion, last: last ?? null };
}

const ALL_TABLES = (db: AppDatabase) => [
  db.exercises,
  db.sessionTemplates,
  db.workouts,
  db.performedExercises,
  db.sets,
  db.settings,
];

export interface StartOptions {
  /** Return after a break (§7.6): loads −10 % on this session. */
  reduceLoads?: boolean;
}

/**
 * Creates the workout with every exercise and its pre-filled sets. Returns its id.
 * During a deload week the session is marked isDeload: one set less per exercise, loads −10 %.
 */
export async function startWorkout(db: AppDatabase, templateId: string, now: number, options: StartOptions = {}): Promise<string> {
  return db.transaction('rw', ALL_TABLES(db), async () => {
    if (await getActiveWorkout(db)) throw new Error('A workout is already in progress');
    const template = await db.sessionTemplates.get(templateId);
    if (!template) throw new Error(`Unknown template ${templateId}`);
    const settings = await db.settings.get(SETTINGS_ID);
    const targetRPE = settings?.targetRPE ?? DEFAULT_TARGET_RPE;
    const deload = (settings?.deloadRemaining ?? 0) > 0;
    const lighter = deload || options.reduceLoads === true;

    const workout: Workout = {
      id: newId(),
      templateId,
      startedAt: now,
      endedAt: null,
      readiness: null,
      notes: '',
      isDeload: deload,
      status: 'in_progress',
      activeRest: null,
      ...(options.reduceLoads && !deload ? { reducedLoads: true } : {}),
    };
    await db.workouts.add(workout);

    // Warm-up (§6.2): before the first compound exercise of the session, if enabled.
    let warmupPending = settings?.warmupEnabled !== false;
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
      const withWarmup = warmupPending && exercise.isCompound;
      if (withWarmup) warmupPending = false;
      const sets = deload ? deloadSets(item.baseSets) : item.baseSets;
      await db.sets.bulkAdd(buildSets(pe.id, exercise, suggestion, sets, withWarmup, lighter));
    }
    return workout.id;
  });
}

/**
 * Rows for one exercise: optional warm-up sets (not counted anywhere, §6.2) followed by the
 * working sets pre-filled from the suggestion. With `light`, loads are −10 % (light session).
 */
function buildSets(
  performedExerciseId: string,
  exercise: Exercise,
  suggestion: Suggestion,
  workingSets: number,
  withWarmup: boolean,
  light: boolean,
): SetEntry[] {
  const lighten = (w: number | null) => (light && w !== null ? lightSessionWeight(w, exercise.increment) : w);
  const working = Array.from({ length: workingSets }, (_, i) => prefillForSet(suggestion, i));
  const firstLoad = lighten(working[0]?.weight ?? null);
  const warmups = withWarmup && exercise.kind === 'weighted' ? warmupSets(firstLoad, exercise.increment) : [];

  const row = (index: number, values: Partial<SetEntry>): SetEntry => ({
    id: newId(),
    performedExerciseId,
    index,
    isWarmup: false,
    weight: null,
    reps: null,
    rpe: null,
    completedAt: null,
    suggestedWeight: null,
    suggestedReps: null,
    ...values,
  });
  return [
    ...warmups.map((w, i) => row(i, { isWarmup: true, weight: w.weight, reps: w.reps, suggestedWeight: w.weight, suggestedReps: w.reps })),
    ...working.map((p, i) =>
      row(warmups.length + i, {
        weight: lighten(p.weight),
        reps: p.reps,
        suggestedWeight: lighten(suggestion.weight),
        suggestedReps: p.reps,
      }),
    ),
  ];
}

/** Warm-up row done / undone with one tap (no RPE, no rest). */
export async function toggleWarmupDone(db: AppDatabase, setId: string, now: number): Promise<void> {
  await db.transaction('rw', db.sets, async () => {
    const set = await db.sets.get(setId);
    if (!set?.isWarmup) return;
    await db.sets.update(setId, { completedAt: set.completedAt === null ? now : null });
  });
}

/**
 * Answer to "Hoy vas fuerte / Día duro" (§7.5). "Sí": the new load goes to the remaining
 * working sets of that exercise, with new rep targets (the next set gets `reps`, the
 * following ones keep their planned drop). Either way the question is not asked again.
 */
export async function answerFormCheck(
  db: AppDatabase,
  performedExerciseId: string,
  accepted: { weight: number; reps: number } | null,
  /** Working set (0-based) the question followed; the first set by default. */
  afterSet = 0,
): Promise<void> {
  await db.transaction('rw', [db.sets, db.performedExercises], async () => {
    if (accepted !== null) {
      const pending = (await db.sets.where('performedExerciseId').equals(performedExerciseId).sortBy('index')).filter(
        (s) => !s.isWarmup && s.completedAt === null,
      );
      const base = pending[0]?.reps ?? accepted.reps;
      for (const s of pending) {
        const reps = Math.max(1, accepted.reps - (base - (s.reps ?? base)));
        await db.sets.update(s.id, { weight: accepted.weight, reps, suggestedWeight: accepted.weight, suggestedReps: reps });
      }
    }
    await db.performedExercises.update(performedExerciseId, { formCheckAnswered: true, promptAnsweredForSet: afterSet });
  });
}

export async function setReadiness(db: AppDatabase, workoutId: string, readiness: Readiness | null): Promise<void> {
  await db.workouts.update(workoutId, { readiness });
}

/**
 * "¿Hacemos una sesión ligera hoy?" (asked once). Yes → every remaining working load of the
 * workout −10 %, and no bonus set.
 */
export async function answerLightSession(db: AppDatabase, workoutId: string, accept: boolean): Promise<void> {
  await db.transaction('rw', [db.workouts, db.performedExercises, db.sets, db.exercises], async () => {
    await db.workouts.update(workoutId, { lightSessionOffered: true, ...(accept ? { lightSession: true } : {}) });
    if (!accept) return;
    const performed = await db.performedExercises.where('workoutId').equals(workoutId).toArray();
    for (const pe of performed) {
      const exercise = await db.exercises.get(pe.exerciseId);
      if (!exercise) continue;
      await db.sets
        .where('performedExerciseId')
        .equals(pe.id)
        .filter((s) => !s.isWarmup && s.completedAt === null && s.weight !== null)
        .modify((s: SetEntry) => {
          s.weight = lightSessionWeight(s.weight!, exercise.increment);
        });
    }
  });
}

/**
 * "Cambiar ejercicio" (§6.2): the alternative takes the slot (same template targets) with its
 * own history and suggestion. Only before any working set of that slot is done.
 */
export async function swapExercise(db: AppDatabase, performedExerciseId: string, newExerciseId: string): Promise<void> {
  await db.transaction('rw', ALL_TABLES(db), async () => {
    const pe = await db.performedExercises.get(performedExerciseId);
    if (!pe) throw new Error(`Unknown performed exercise ${performedExerciseId}`);
    const sets = await db.sets.where('performedExerciseId').equals(pe.id).toArray();
    if (sets.some((s) => !s.isWarmup && s.completedAt !== null)) throw new Error('Sets already done');
    const exercise = await db.exercises.get(newExerciseId);
    if (!exercise) throw new Error(`Unknown exercise ${newExerciseId}`);
    const workout = await db.workouts.get(pe.workoutId);
    const template = workout && (await db.sessionTemplates.get(workout.templateId));
    const item = template?.items.find((i) => i.order === pe.order);
    const settings = await db.settings.get(SETTINGS_ID);

    const { suggestion } = await suggestionFor(
      db,
      exercise,
      item ?? { repMin: 8, repMax: 12, targetRPE: null },
      settings?.targetRPE ?? DEFAULT_TARGET_RPE,
      pe.workoutId,
    );
    const workingCount = Math.max(1, sets.filter((s) => !s.isWarmup).length);
    const hadWarmup = sets.some((s) => s.isWarmup);

    await db.sets.bulkDelete(sets.map((s) => s.id));
    await db.sets.bulkAdd(
      // Keep the −10 % of the session (light session, deload week, return after a break).
      buildSets(
        pe.id,
        exercise,
        suggestion,
        workingCount,
        hadWarmup && exercise.isCompound,
        !!workout && (workout.lightSession === true || workout.isDeload || workout.reducedLoads === true),
      ),
    );
    await db.performedExercises.update(pe.id, { exerciseId: exercise.id, formCheckAnswered: false, promptAnsweredForSet: -1 });
  });
}

/** Exercise sheet edits (machine settings, personal notes). */
export async function updateExerciseInfo(
  db: AppDatabase,
  exerciseId: string,
  values: Partial<Pick<Exercise, 'machineSettings' | 'notes'>>,
): Promise<void> {
  await db.exercises.update(exerciseId, values);
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

/**
 * Ends the workout; sets never marked "Hecho" are dropped so they never count anywhere.
 * A session without a single completed working set is not a session: it is discarded
 * (status 'abandoned'), so it does not move the rotation, the weekly count or the deload week.
 * @returns 'saved' or 'discarded'
 */
export async function finishWorkout(db: AppDatabase, workoutId: string, now: number, notes?: string): Promise<'saved' | 'discarded'> {
  return db.transaction('rw', [db.workouts, db.performedExercises, db.sets, db.settings], async () => {
    const workout = await db.workouts.get(workoutId);
    const peIds = await db.performedExercises.where('workoutId').equals(workoutId).primaryKeys();
    await db.sets.where('performedExerciseId').anyOf(peIds).filter((s) => s.completedAt === null).delete();
    const done = await db.sets.where('performedExerciseId').anyOf(peIds).filter((s) => !s.isWarmup).count();
    const saved = done > 0;

    if (saved && workout?.isDeload && workout.status === 'in_progress') {
      const settings = await db.settings.get(SETTINGS_ID);
      await db.settings.update(SETTINGS_ID, { deloadRemaining: Math.max(0, (settings?.deloadRemaining ?? 0) - 1) });
    }
    await db.workouts.update(workoutId, {
      status: saved ? 'done' : 'abandoned',
      endedAt: now,
      activeRest: null,
      ...(notes !== undefined ? { notes } : {}),
    });
    return saved ? 'saved' : 'discarded';
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

/** Deletes a past session and everything in it (history correction, §6.4). */
export async function deleteWorkout(db: AppDatabase, workoutId: string): Promise<void> {
  await db.transaction('rw', [db.workouts, db.performedExercises, db.sets], async () => {
    const peIds = await db.performedExercises.where('workoutId').equals(workoutId).primaryKeys();
    await db.sets.where('performedExerciseId').anyOf(peIds).delete();
    await db.performedExercises.bulkDelete(peIds);
    await db.workouts.delete(workoutId);
  });
}

/** Deload week accepted (§7.6): the next 4 sessions are deload sessions. */
export async function startDeload(db: AppDatabase): Promise<void> {
  await db.settings.update(SETTINGS_ID, { deloadRemaining: DELOAD_SESSIONS, deloadSnoozedAt: null });
}

export async function snoozeDeload(db: AppDatabase, now: number): Promise<void> {
  await db.settings.update(SETTINGS_ID, { deloadSnoozedAt: now });
}

export async function endDeload(db: AppDatabase): Promise<void> {
  await db.settings.update(SETTINGS_ID, { deloadRemaining: 0 });
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
