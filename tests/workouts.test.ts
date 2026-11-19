import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '../src/db/database.ts';
import { loadHomeData } from '../src/db/home.ts';
import {
  abandonWorkout,
  addSet,
  adjustActiveRest,
  completeSet,
  finishWorkout,
  getActiveWorkout,
  lastPerformance,
  loadWorkoutView,
  removeSet,
  setActiveRest,
  setExerciseSkipped,
  startWorkout,
  updateSetValues,
} from '../src/db/workouts.ts';
import { seedIfEmpty } from '../src/seed/seed.ts';

let db: AppDatabase;
const T0 = new Date(2026, 10, 10, 18, 0).getTime();
const HOUR = 3_600_000;

beforeEach(async () => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  await seedIfEmpty(db);
});
afterEach(async () => {
  await db.delete();
});

/** Does every set of the first `n` exercises with the given values, then finishes. */
async function doWorkout(templateId: string, at: number, values: { weight: number; reps: number; rpe: number }, exercises = 1) {
  const id = await startWorkout(db, templateId, at);
  const view = (await loadWorkoutView(db, id))!;
  for (const ex of view.exercises.slice(0, exercises)) {
    for (const set of ex.sets.filter((s) => !s.isWarmup)) {
      await updateSetValues(db, set.id, { weight: values.weight, reps: values.reps });
      await completeSet(db, set.id, values.rpe, at + HOUR / 2);
    }
  }
  await finishWorkout(db, id, at + HOUR);
  return id;
}

describe('startWorkout', () => {
  it('creates every exercise of the template with its base sets', async () => {
    const id = await startWorkout(db, 'superior-a', T0);
    const view = (await loadWorkoutView(db, id))!;
    expect(view.workout.status).toBe('in_progress');
    expect(view.exercises.map((e) => e.exercise.id)).toEqual([
      'chest-press',
      'lat-pulldown',
      'seated-shoulder-press',
      'row',
      'face-pull',
      'biceps-curl',
      'cable-triceps',
    ]);
    expect(view.exercises.map((e) => e.sets.length)).toEqual([3, 3, 3, 3, 3, 2, 2]);
    expect(view.exercises[5]!.item?.optionalExtraSets).toBe(1);
  });

  it('first time: empty load, reps pre-filled for calibration', async () => {
    const id = await startWorkout(db, 'pierna-a', T0);
    const hipThrust = (await loadWorkoutView(db, id))!.exercises[0]!;
    expect(hipThrust.sets[0]).toMatchObject({ weight: null, reps: 8, completedAt: null }); // 6-10 → ~8
  });

  it('pre-fills from the engine suggestion once there is history', async () => {
    await doWorkout('pierna-a', T0, { weight: 40, reps: 10, rpe: 8 }); // hip thrust 3 × 10 @ 40 → +2,5
    const id = await startWorkout(db, 'pierna-a', T0 + 72 * HOUR);
    const hipThrust = (await loadWorkoutView(db, id))!.exercises[0]!;
    const working = hipThrust.sets.filter((s) => !s.isWarmup);
    expect(working.map((s) => [s.weight, s.reps])).toEqual([
      // 3 × 10 @ 40 kg RPE 8 = 12 reps possible at RPE 9 (top of 6-10 passed): e1RM 56 →
      // 7 reps at RPE 9 needs 44,2 → 42,5 kg, where she can do 8 reps at RPE 9.
      [42.5, 8],
      [42.5, 8],
      [42.5, 8],
    ]);
    expect(working[0]!.suggestedWeight).toBe(42.5);
    // Warm-up before the first compound exercise: ~50 % × 10, ~70 % × 5 (§6.2), listed first.
    expect(hipThrust.sets.filter((s) => s.isWarmup).map((s) => [s.index, s.weight, s.reps])).toEqual([
      [0, 20, 10],
      [1, 30, 5],
    ]);
  });

  it('refuses a second workout while one is in progress', async () => {
    await startWorkout(db, 'pierna-a', T0);
    await expect(startWorkout(db, 'superior-a', T0)).rejects.toThrow();
  });
});

describe('during the workout', () => {
  it('saves every change so the session can be resumed', async () => {
    const id = await startWorkout(db, 'pierna-a', T0);
    const set = (await loadWorkoutView(db, id))!.exercises[0]!.sets[0]!;
    await updateSetValues(db, set.id, { weight: 50 });
    await updateSetValues(db, set.id, { reps: 9 });

    // "Reload": a brand-new connection to the same database.
    const reopened = new AppDatabase(db.name);
    expect((await getActiveWorkout(reopened))?.id).toBe(id);
    const again = (await loadWorkoutView(reopened, id))!.exercises[0]!.sets[0]!;
    expect(again).toMatchObject({ weight: 50, reps: 9, completedAt: null });
    reopened.close();
  });

  it('completes a set with its RPE', async () => {
    const id = await startWorkout(db, 'pierna-a', T0);
    const set = (await loadWorkoutView(db, id))!.exercises[0]!.sets[0]!;
    await updateSetValues(db, set.id, { weight: 40 });
    await completeSet(db, set.id, 8.5, T0 + 60_000);
    expect(await db.sets.get(set.id)).toMatchObject({ weight: 40, reps: 8, rpe: 8.5, completedAt: T0 + 60_000 });
  });

  it('carries the chosen load into the following empty sets (calibration)', async () => {
    const id = await startWorkout(db, 'pierna-a', T0);
    const sets = (await loadWorkoutView(db, id))!.exercises[0]!.sets;
    await updateSetValues(db, sets[0]!.id, { weight: 40 });
    await updateSetValues(db, sets[2]!.id, { weight: 35 });
    await completeSet(db, sets[0]!.id, 8, T0);
    expect((await db.sets.get(sets[1]!.id))?.weight).toBe(40);
    expect((await db.sets.get(sets[2]!.id))?.weight).toBe(35); // already set by hand: untouched
  });

  it('persists the rest timer so it survives a reload, and clears it at the end', async () => {
    const id = await startWorkout(db, 'pierna-a', T0);
    await setActiveRest(db, id, { startedAt: T0, endsAt: T0 + 150_000, durationSeconds: 150 });

    const reopened = new AppDatabase(db.name);
    expect((await getActiveWorkout(reopened))?.activeRest).toEqual({ startedAt: T0, endsAt: T0 + 150_000, durationSeconds: 150 });
    reopened.close();

    await finishWorkout(db, id, T0 + HOUR);
    expect((await db.workouts.get(id))?.activeRest).toBeNull();
  });

  it('counts every quick −15 s tap', async () => {
    const id = await startWorkout(db, 'pierna-a', T0);
    await setActiveRest(db, id, { startedAt: T0, endsAt: T0 + 150_000, durationSeconds: 150 });
    await Promise.all([1, 2, 3].map(() => adjustActiveRest(db, id, -15, T0)));
    expect((await db.workouts.get(id))?.activeRest).toMatchObject({ endsAt: T0 + 105_000, durationSeconds: 105 });
  });

  it('refuses to complete a set without reps', async () => {
    const id = await startWorkout(db, 'pierna-a', T0);
    const set = (await loadWorkoutView(db, id))!.exercises[0]!.sets[0]!;
    await updateSetValues(db, set.id, { reps: null });
    await expect(completeSet(db, set.id, 8, T0)).rejects.toThrow();
  });

  it('adds and removes sets, keeping indexes contiguous', async () => {
    const id = await startWorkout(db, 'pierna-a', T0);
    const ex = (await loadWorkoutView(db, id))!.exercises[0]!;
    await updateSetValues(db, ex.sets[2]!.id, { weight: 45 });
    const added = await addSet(db, ex.performed.id);
    expect(await db.sets.get(added)).toMatchObject({ index: 3, weight: 45, completedAt: null });

    await removeSet(db, ex.sets[0]!.id);
    const after = (await loadWorkoutView(db, id))!.exercises[0]!.sets;
    expect(after.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(after.at(-1)!.id).toBe(added);
  });
});

describe('finishing', () => {
  it('drops sets never marked done and keeps the completed ones', async () => {
    const id = await startWorkout(db, 'pierna-a', T0);
    const ex = (await loadWorkoutView(db, id))!.exercises[0]!;
    await updateSetValues(db, ex.sets[0]!.id, { weight: 40 });
    await completeSet(db, ex.sets[0]!.id, 8, T0);
    await finishWorkout(db, id, T0 + HOUR);

    const view = (await loadWorkoutView(db, id))!;
    expect(view.workout).toMatchObject({ status: 'done', endedAt: T0 + HOUR });
    expect(view.exercises[0]!.sets).toHaveLength(1);
    expect(view.exercises[1]!.sets).toHaveLength(0);
    expect(await getActiveWorkout(db)).toBeUndefined();
  });

  it('abandoned workouts are ignored by the history', async () => {
    const id = await startWorkout(db, 'pierna-a', T0);
    const set = (await loadWorkoutView(db, id))!.exercises[0]!.sets[0]!;
    await updateSetValues(db, set.id, { weight: 40 });
    await completeSet(db, set.id, 8, T0);
    await abandonWorkout(db, id, T0 + HOUR);
    expect(await lastPerformance(db, 'hip-thrust')).toBeNull();
  });
});

describe('lastPerformance', () => {
  it('returns the most recent completed working sets, skipping deloads and skipped exercises', async () => {
    await doWorkout('pierna-a', T0, { weight: 40, reps: 10, rpe: 8 });
    await doWorkout('pierna-a', T0 + 72 * HOUR, { weight: 42.5, reps: 8, rpe: 8 });

    // A later workout where hip thrust was skipped does not hide the previous one.
    const skippedId = await startWorkout(db, 'pierna-a', T0 + 144 * HOUR);
    const pe = (await loadWorkoutView(db, skippedId))!.exercises[0]!.performed;
    await setExerciseSkipped(db, pe.id, true);
    await finishWorkout(db, skippedId, T0 + 145 * HOUR);

    const last = await lastPerformance(db, 'hip-thrust');
    expect(last?.sets).toEqual([
      { weight: 42.5, reps: 8, rpe: 8 },
      { weight: 42.5, reps: 8, rpe: 8 },
      { weight: 42.5, reps: 8, rpe: 8 },
    ]);

    // Deload sessions are excluded.
    await db.workouts.update(last!.workout.id, { isDeload: true });
    expect((await lastPerformance(db, 'hip-thrust'))?.sets[0]?.weight).toBe(40);
  });

  it('shares history between sessions B and D for the same exercise', async () => {
    const id = await startWorkout(db, 'superior-a', T0);
    const curl = (await loadWorkoutView(db, id))!.exercises.find((e) => e.exercise.id === 'biceps-curl')!;
    for (const s of curl.sets) {
      await updateSetValues(db, s.id, { weight: 8, reps: 12 });
      await completeSet(db, s.id, 8, T0);
    }
    await finishWorkout(db, id, T0 + HOUR);

    const d = await startWorkout(db, 'superior-b', T0 + 48 * HOUR);
    const curlD = (await loadWorkoutView(db, d))!.exercises.find((e) => e.exercise.id === 'biceps-curl')!;
    // 12 reps @ RPE 8 = 13 at RPE 9, + 1 rep of progress → same load, 14 reps (10-15).
    expect(curlD.sets[0]).toMatchObject({ weight: 8, reps: 14 });
  });
});

describe('home data', () => {
  it('suggests the next session in the rotation and counts the last 7 days', async () => {
    let home = await loadHomeData(db, T0);
    expect(home.nextTemplateId).toBe('pierna-a');
    expect(home.last7Days.sessions).toBe(0);

    await doWorkout('pierna-a', T0, { weight: 40, reps: 10, rpe: 8 }, 2); // hip thrust + prensa
    home = await loadHomeData(db, T0 + 2 * HOUR);
    expect(home.nextTemplateId).toBe('superior-a');
    expect(home.lastDoneAt['pierna-a']).toBe(T0 + HOUR);
    expect(home.lastLegSessionAt).toBe(T0 + HOUR);
    expect(home.last7Days.sessions).toBe(1);
    expect(home.last7Days.setsByMuscle).toEqual({ glutes: 4.5, quads: 3 });

    home = await loadHomeData(db, T0 + 8 * 24 * HOUR);
    expect(home.last7Days.sessions).toBe(0);
  });

  it('exposes the workout in progress', async () => {
    const id = await startWorkout(db, 'superior-b', T0);
    expect((await loadHomeData(db, T0)).activeWorkout?.id).toBe(id);
  });
});
