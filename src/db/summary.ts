/** Read models for the end-of-workout summary (§6.2) and the history list (§6.4). */

import { findRecords, totalVolume, type PerformedSet, type PersonalRecord } from '../engine/index.ts';
import type { AppDatabase } from './database.ts';
import type { Readiness, SetEntry, Workout } from './types.ts';

const toPerformed = (s: SetEntry): PerformedSet => ({ weight: s.weight, reps: s.reps!, rpe: s.rpe });
const isWorkingDone = (s: SetEntry) => !s.isWarmup && s.completedAt !== null && s.reps !== null;

export interface ExerciseRecords {
  exerciseName: string;
  records: PersonalRecord[];
}

export interface WorkoutSummary {
  workout: Workout;
  templateName: string;
  templateCode: string;
  durationMs: number;
  setCount: number;
  exerciseCount: number;
  /** Σ kg × reps of completed working sets. */
  volumeKg: number;
  /** Sets not marked "Hecho" (dropped when the workout is finished). */
  pendingSets: number;
  records: ExerciseRecords[];
  readiness: Readiness | null;
}

/** Working sets of an exercise from completed workouts started before `before`. */
async function previousSets(db: AppDatabase, exerciseId: string, excludeWorkoutId: string, before: number): Promise<PerformedSet[]> {
  const performed = (await db.performedExercises.where('exerciseId').equals(exerciseId).toArray()).filter((p) => !p.skipped);
  const workouts = await db.workouts.bulkGet(performed.map((p) => p.workoutId));
  const ids = performed
    .filter((_, i) => {
      const w = workouts[i];
      return w && w.status === 'done' && w.id !== excludeWorkoutId && w.startedAt < before;
    })
    .map((p) => p.id);
  const sets = await db.sets.where('performedExerciseId').anyOf(ids).toArray();
  return sets.filter(isWorkingDone).map(toPerformed);
}

export async function loadWorkoutSummary(db: AppDatabase, workoutId: string, now: number): Promise<WorkoutSummary | null> {
  const workout = await db.workouts.get(workoutId);
  if (!workout) return null;
  const template = await db.sessionTemplates.get(workout.templateId);
  const performed = (await db.performedExercises.where('workoutId').equals(workoutId).sortBy('order')).filter((p) => !p.skipped);
  const exercises = await db.exercises.bulkGet(performed.map((p) => p.exerciseId));
  const allSets = await db.sets.where('performedExerciseId').anyOf(performed.map((p) => p.id)).toArray();

  const records: ExerciseRecords[] = [];
  let setCount = 0;
  let exerciseCount = 0;
  const done: PerformedSet[] = [];

  for (const [i, pe] of performed.entries()) {
    const exercise = exercises[i];
    const sets = allSets.filter((s) => s.performedExerciseId === pe.id && isWorkingDone(s)).map(toPerformed);
    if (sets.length === 0) continue;
    exerciseCount++;
    setCount += sets.length;
    done.push(...sets);
    if (exercise?.kind === 'weighted') {
      const found = findRecords(await previousSets(db, exercise.id, workoutId, workout.startedAt), sets);
      if (found.length) records.push({ exerciseName: exercise.name, records: found });
    }
  }

  return {
    workout,
    templateName: template?.name ?? 'Sesión',
    templateCode: template?.code ?? '',
    durationMs: (workout.endedAt ?? now) - workout.startedAt,
    setCount,
    exerciseCount,
    volumeKg: totalVolume(done),
    pendingSets: allSets.filter((s) => s.completedAt === null && !s.isWarmup).length,
    records,
    readiness: workout.readiness,
  };
}

export interface HistoryEntry {
  workout: Workout;
  templateName: string;
  templateCode: string;
  durationMs: number;
  setCount: number;
  volumeKg: number;
}

/** Completed workouts, newest first. */
export async function listHistory(db: AppDatabase): Promise<HistoryEntry[]> {
  const workouts = (await db.workouts.where('status').equals('done').sortBy('startedAt')).reverse();
  const templates = new Map((await db.sessionTemplates.toArray()).map((t) => [t.id, t]));
  const performed = await db.performedExercises.where('workoutId').anyOf(workouts.map((w) => w.id)).toArray();
  const sets = await db.sets.where('performedExerciseId').anyOf(performed.map((p) => p.id)).toArray();

  const workoutOf = new Map(performed.map((p) => [p.id, p.workoutId]));
  const byWorkout = new Map<string, PerformedSet[]>();
  for (const s of sets) {
    if (!isWorkingDone(s)) continue;
    const wid = workoutOf.get(s.performedExerciseId);
    if (!wid) continue;
    byWorkout.set(wid, [...(byWorkout.get(wid) ?? []), toPerformed(s)]);
  }

  return workouts.map((w) => {
    const done = byWorkout.get(w.id) ?? [];
    const t = templates.get(w.templateId);
    return {
      workout: w,
      templateName: t?.name ?? 'Sesión',
      templateCode: t?.code ?? '',
      durationMs: (w.endedAt ?? w.startedAt) - w.startedAt,
      setCount: done.length,
      volumeKg: totalVolume(done),
    };
  });
}
