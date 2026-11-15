/** Read models for progression (§6.4): per-exercise history, records, weekly volume. */

import {
  bestE1RM,
  isStagnating,
  setsPerMuscle,
  totalVolume,
  type PerformedSet,
  type VolumeEntry,
} from '../engine/index.ts';
import type { AppDatabase } from './database.ts';
import { MUSCLES, type Exercise, type Muscle, type SetEntry, type Workout } from './types.ts';

const isWorkingDone = (s: SetEntry) => !s.isWarmup && s.completedAt !== null && s.reps !== null;
const toPerformed = (s: SetEntry): PerformedSet => ({ weight: s.weight, reps: s.reps!, rpe: s.rpe });

export interface ExerciseSession {
  workoutId: string;
  at: number;
  isDeload: boolean;
  sets: PerformedSet[];
  /** Best e1RM of the session (null for timed / bodyweight). */
  e1rm: number | null;
  volumeKg: number;
}

export interface ExerciseProgress {
  exercise: Exercise;
  /** Oldest first. */
  sessions: ExerciseSession[];
  bestE1RM: { value: number; at: number; weight: number; reps: number } | null;
  /** Heaviest load lifted for at least N reps, for each rep count she has done. */
  bestByReps: Array<{ reps: number; weight: number; at: number }>;
  stagnating: boolean;
}

/** Every completed session of one exercise (alternatives are separate exercises). */
export async function loadExerciseProgress(db: AppDatabase, exerciseId: string): Promise<ExerciseProgress | null> {
  const exercise = await db.exercises.get(exerciseId);
  if (!exercise) return null;
  const performed = (await db.performedExercises.where('exerciseId').equals(exerciseId).toArray()).filter((p) => !p.skipped);
  const workouts = await db.workouts.bulkGet(performed.map((p) => p.workoutId));
  const allSets = await db.sets.where('performedExerciseId').anyOf(performed.map((p) => p.id)).toArray();

  const sessions: ExerciseSession[] = [];
  performed.forEach((pe, i) => {
    const w = workouts[i];
    if (!w || w.status !== 'done') return;
    const sets = allSets
      .filter((s) => s.performedExerciseId === pe.id && isWorkingDone(s))
      .sort((a, b) => a.index - b.index)
      .map(toPerformed);
    if (sets.length === 0) return;
    sessions.push({ workoutId: w.id, at: w.startedAt, isDeload: w.isDeload, sets, e1rm: bestE1RM(exercise.kind, sets), volumeKg: totalVolume(sets) });
  });
  sessions.sort((a, b) => a.at - b.at);

  let best: ExerciseProgress['bestE1RM'] = null;
  const byReps = new Map<number, { weight: number; at: number }>();
  for (const s of sessions) {
    for (const set of s.sets) {
      if (exercise.kind !== 'weighted' || set.weight === null || set.weight <= 0) continue;
      const e1 = bestE1RM('weighted', [set])!;
      if (!best || e1 > best.value) best = { value: e1, at: s.at, weight: set.weight, reps: set.reps };
      const current = byReps.get(set.reps);
      if (!current || set.weight > current.weight) byReps.set(set.reps, { weight: set.weight, at: s.at });
    }
  }
  // "At least N reps": a heavier load done for more reps also counts for fewer reps.
  const repsDone = [...byReps.keys()].sort((a, b) => a - b);
  const bestByReps = repsDone.map((reps) => {
    let top = byReps.get(reps)!;
    for (const [r, v] of byReps) if (r >= reps && v.weight > top.weight) top = v;
    return { reps, weight: top.weight, at: top.at };
  });

  const e1rms = sessions.filter((s) => !s.isDeload && s.e1rm !== null).map((s) => s.e1rm!);
  return { exercise, sessions, bestE1RM: best, bestByReps, stagnating: isStagnating(e1rms) };
}

export interface ExerciseSummaryRow {
  exercise: Exercise;
  sessions: number;
  lastAt: number;
}

/** Exercises with at least one completed set, most recently trained first. */
export async function listTrainedExercises(db: AppDatabase): Promise<ExerciseSummaryRow[]> {
  const done = new Map((await db.workouts.where('status').equals('done').toArray()).map((w) => [w.id, w]));
  const performed = (await db.performedExercises.where('workoutId').anyOf([...done.keys()]).toArray()).filter((p) => !p.skipped);
  const withSets = new Set(
    (await db.sets.where('performedExerciseId').anyOf(performed.map((p) => p.id)).toArray()).filter(isWorkingDone).map((s) => s.performedExerciseId),
  );
  const rows = new Map<string, { sessions: number; lastAt: number }>();
  for (const p of performed) {
    if (!withSets.has(p.id)) continue;
    const at = done.get(p.workoutId)!.startedAt;
    const row = rows.get(p.exerciseId) ?? { sessions: 0, lastAt: 0 };
    rows.set(p.exerciseId, { sessions: row.sessions + 1, lastAt: Math.max(row.lastAt, at) });
  }
  const exercises = await db.exercises.bulkGet([...rows.keys()]);
  return exercises
    .flatMap((e) => (e ? [{ exercise: e, ...rows.get(e.id)! }] : []))
    .sort((a, b) => b.lastAt - a.lastAt);
}

/** Monday 00:00 (local time) of the week containing `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
}

export interface WeekVolume {
  weekStart: number;
  setsByMuscle: Record<Muscle, number>;
}

/** Working sets per muscle for each of the last `weeks` calendar weeks (oldest first). */
export async function loadWeeklyVolume(db: AppDatabase, now: number, weeks = 8): Promise<WeekVolume[]> {
  const current = weekStart(now);
  const starts = Array.from({ length: weeks }, (_, i) => {
    const d = new Date(current);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7 * (weeks - 1 - i)).getTime();
  });
  const from = starts[0]!;
  const workouts = (await db.workouts.where('startedAt').aboveOrEqual(from).toArray()).filter((w: Workout) => w.status === 'done');
  const performed = (await db.performedExercises.where('workoutId').anyOf(workouts.map((w) => w.id)).toArray()).filter((p) => !p.skipped);
  const exercises = new Map((await db.exercises.bulkGet(performed.map((p) => p.exerciseId))).flatMap((e) => (e ? [[e.id, e]] : [])));
  const counts = new Map<string, number>();
  for (const s of await db.sets.where('performedExerciseId').anyOf(performed.map((p) => p.id)).toArray()) {
    if (isWorkingDone(s)) counts.set(s.performedExerciseId, (counts.get(s.performedExerciseId) ?? 0) + 1);
  }
  const workoutWeek = new Map(workouts.map((w) => [w.id, weekStart(w.startedAt)]));

  return starts.map((ws) => {
    const entries: VolumeEntry[] = performed
      .filter((p) => workoutWeek.get(p.workoutId) === ws)
      .flatMap((p) => {
        const e = exercises.get(p.exerciseId);
        return e ? [{ primaryMuscle: e.primaryMuscle, secondaryMuscle: e.secondaryMuscle, sets: counts.get(p.id) ?? 0 }] : [];
      });
    const totals = setsPerMuscle(entries);
    const setsByMuscle = Object.fromEntries(MUSCLES.map((m) => [m, totals[m] ?? 0])) as Record<Muscle, number>;
    return { weekStart: ws, setsByMuscle };
  });
}
