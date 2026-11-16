import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '../src/db/database.ts';
import { loadHomeData } from '../src/db/home.ts';
import { loadWorkoutSummary } from '../src/db/summary.ts';
import { SETTINGS_ID } from '../src/db/types.ts';
import {
  answerFormCheck,
  answerLightSession,
  completeSet,
  finishWorkout,
  lastPerformance,
  loadWorkoutView,
  startDeload,
  startWorkout,
  swapExercise,
  toggleWarmupDone,
  updateExerciseInfo,
  updateSetValues,
} from '../src/db/workouts.ts';
import { seedIfEmpty } from '../src/seed/seed.ts';

let db: AppDatabase;
const T0 = new Date(2026, 10, 10, 18, 0).getTime();
const DAY = 24 * 3_600_000;

beforeEach(async () => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  await seedIfEmpty(db);
});
afterEach(async () => {
  await db.delete();
});

const working = async (workoutId: string, exerciseIndex: number) =>
  (await loadWorkoutView(db, workoutId))!.exercises[exerciseIndex]!.sets.filter((s) => !s.isWarmup);

/** A finished Pierna A where hip thrust was done 3 × 10 @ 40 kg (so the next one has loads). */
async function history() {
  const id = await startWorkout(db, 'pierna-a', T0);
  for (const s of await working(id, 0)) {
    await updateSetValues(db, s.id, { weight: 40, reps: 10 });
    await completeSet(db, s.id, 8, T0);
  }
  await finishWorkout(db, id, T0 + 3_600_000);
}

describe('form check after the first set', () => {
  it('applies the accepted load to the remaining sets only, and is asked once', async () => {
    await history();
    const id = await startWorkout(db, 'pierna-a', T0 + 3 * DAY);
    const [first, second, third] = await working(id, 0);
    await completeSet(db, first!.id, 6, T0 + 3 * DAY);

    const pe = (await loadWorkoutView(db, id))!.exercises[0]!.performed;
    await answerFormCheck(db, pe.id, 45);
    expect((await db.sets.get(first!.id))?.weight).toBe(42.5);
    expect((await db.sets.get(second!.id))?.weight).toBe(45);
    expect((await db.sets.get(third!.id))?.weight).toBe(45);
    expect((await db.performedExercises.get(pe.id))?.formCheckAnswered).toBe(true);
  });

  it('"No" keeps the loads', async () => {
    await history();
    const id = await startWorkout(db, 'pierna-a', T0 + 3 * DAY);
    const pe = (await loadWorkoutView(db, id))!.exercises[0]!.performed;
    await answerFormCheck(db, pe.id, null);
    expect((await working(id, 0)).map((s) => s.weight)).toEqual([42.5, 42.5, 42.5]);
    expect((await db.performedExercises.get(pe.id))?.formCheckAnswered).toBe(true);
  });
});

describe('light session', () => {
  it('yes → remaining loads −10 %, done sets untouched', async () => {
    await history();
    const id = await startWorkout(db, 'pierna-a', T0 + 3 * DAY);
    const [first] = await working(id, 0);
    await completeSet(db, first!.id, 10, T0 + 3 * DAY);

    await answerLightSession(db, id, true);
    expect((await working(id, 0)).map((s) => s.weight)).toEqual([42.5, 37.5, 37.5]); // 42,5 × 0,9 = 38,25 → 37,5
    expect(await db.workouts.get(id)).toMatchObject({ lightSession: true, lightSessionOffered: true });
  });

  it('no → nothing changes, but it is not offered again', async () => {
    const id = await startWorkout(db, 'pierna-a', T0);
    await answerLightSession(db, id, false);
    expect(await db.workouts.get(id)).toMatchObject({ lightSessionOffered: true });
    expect((await db.workouts.get(id))?.lightSession).toBeFalsy();
  });
});

describe('warm-up', () => {
  it('only before the first compound exercise, and only when a load is known', async () => {
    const first = await startWorkout(db, 'pierna-a', T0);
    // No history yet: no load to base the warm-up on.
    expect((await loadWorkoutView(db, first))!.exercises[0]!.sets.some((s) => s.isWarmup)).toBe(false);
    await finishWorkout(db, first, T0 + 1000);
    await history();

    const id = await startWorkout(db, 'pierna-a', T0 + 3 * DAY);
    const view = (await loadWorkoutView(db, id))!;
    expect(view.exercises[0]!.sets.filter((s) => s.isWarmup)).toHaveLength(2); // hip thrust
    expect(view.exercises.slice(1).every((e) => e.sets.every((s) => !s.isWarmup))).toBe(true);
  });

  it('can be disabled in the settings', async () => {
    await history();
    await db.settings.update(SETTINGS_ID, { warmupEnabled: false });
    const id = await startWorkout(db, 'pierna-a', T0 + 3 * DAY);
    expect((await loadWorkoutView(db, id))!.exercises[0]!.sets.some((s) => s.isWarmup)).toBe(false);
  });

  it('is done with one tap and never counted', async () => {
    await history();
    const id = await startWorkout(db, 'pierna-a', T0 + 3 * DAY);
    const sets = (await loadWorkoutView(db, id))!.exercises[0]!.sets;
    for (const w of sets.filter((s) => s.isWarmup)) await toggleWarmupDone(db, w.id, T0 + 3 * DAY);
    const [w1] = sets.filter((s) => s.isWarmup);
    expect((await db.sets.get(w1!.id))?.completedAt).toBe(T0 + 3 * DAY);
    await toggleWarmupDone(db, w1!.id, T0 + 3 * DAY);
    expect((await db.sets.get(w1!.id))?.completedAt).toBeNull();
    await toggleWarmupDone(db, w1!.id, T0 + 3 * DAY);

    const [s1] = sets.filter((s) => !s.isWarmup);
    await completeSet(db, s1!.id, 8, T0 + 3 * DAY);
    const summary = (await loadWorkoutSummary(db, id, T0 + 3 * DAY + 60_000))!;
    expect(summary.setCount).toBe(1);
    expect(summary.volumeKg).toBe(42.5 * 6);
    await finishWorkout(db, id, T0 + 3 * DAY + 60_000);
    expect((await lastPerformance(db, 'hip-thrust'))?.sets).toHaveLength(1);
  });
});

describe('swapExercise ("Cambiar ejercicio")', () => {
  it('replaces the slot with the alternative, with its own history', async () => {
    const id = await startWorkout(db, 'pierna-b', T0);
    const pe = (await loadWorkoutView(db, id))!.exercises[1]!.performed; // Prensa unilateral
    await swapExercise(db, pe.id, 'bulgarian-split-squat');

    const ex = (await loadWorkoutView(db, id))!.exercises[1]!;
    expect(ex.exercise.name).toBe('Sentadilla búlgara');
    expect(ex.performed.templateExerciseId).toBe('single-leg-press'); // keeps the slot
    expect(ex.item?.repMin).toBe(8); // template targets kept
    expect(ex.sets).toHaveLength(3);
    expect(ex.sets[0]).toMatchObject({ weight: null, reps: 10 }); // never done: calibration
  });

  it('is refused once a working set is done', async () => {
    const id = await startWorkout(db, 'pierna-a', T0);
    const ex = (await loadWorkoutView(db, id))!.exercises[0]!;
    await updateSetValues(db, ex.sets[0]!.id, { weight: 40 });
    await completeSet(db, ex.sets[0]!.id, 8, T0);
    await expect(swapExercise(db, ex.performed.id, 'hip-thrust-machine')).rejects.toThrow();
  });

  it('progression of the alternative is tracked separately', async () => {
    await history(); // hip thrust 40 kg
    const id = await startWorkout(db, 'pierna-a', T0 + 3 * DAY);
    const pe = (await loadWorkoutView(db, id))!.exercises[0]!.performed;
    await swapExercise(db, pe.id, 'hip-thrust-machine');
    const sets = (await loadWorkoutView(db, id))!.exercises[0]!.sets;
    expect(sets.every((s) => s.weight === null)).toBe(true); // nothing borrowed from the barbell version
  });
});

describe('exercise sheet', () => {
  it('saves machine settings', async () => {
    await updateExerciseInfo(db, 'seated-leg-press', { machineSettings: 'asiento 4, respaldo 2' });
    expect((await db.exercises.get('seated-leg-press'))?.machineSettings).toBe('asiento 4, respaldo 2');
  });
});

describe('audit fixes (0.3.1)', () => {
  it('a session finished without any set is discarded and does not move the rotation', async () => {
    const id = await startWorkout(db, 'pierna-a', T0);
    expect(await finishWorkout(db, id, T0 + 60_000)).toBe('discarded');
    expect((await db.workouts.get(id))?.status).toBe('abandoned');
    const home = await loadHomeData(db, T0 + 120_000);
    expect(home.nextTemplateId).toBe('pierna-a');
    expect(home.last7Days.sessions).toBe(0);
    expect(home.backupReminder).toBe(false);
  });

  it('warm-up sets alone do not make a session', async () => {
    await history();
    const id = await startWorkout(db, 'pierna-a', T0 + 3 * DAY);
    const warmup = (await loadWorkoutView(db, id))!.exercises[0]!.sets.find((s) => s.isWarmup)!;
    await toggleWarmupDone(db, warmup.id, T0 + 3 * DAY);
    expect(await finishWorkout(db, id, T0 + 3 * DAY + 60_000)).toBe('discarded');
  });

  it('a discarded deload session does not use up the deload week', async () => {
    await startDeload(db);
    const id = await startWorkout(db, 'pierna-a', T0);
    await finishWorkout(db, id, T0 + 60_000);
    expect((await db.settings.get(SETTINGS_ID))?.deloadRemaining).toBe(4);
  });

  it('a light session does not lower the next suggestion', async () => {
    await history(); // hip thrust 3 × 10 @ 40 → next: 42,5
    const bad = await startWorkout(db, 'pierna-a', T0 + 3 * DAY);
    const [first] = await working(bad, 0);
    await updateSetValues(db, first!.id, { reps: 5 });
    await completeSet(db, first!.id, 10, T0 + 3 * DAY);
    await answerLightSession(db, bad, true);
    for (const s of (await working(bad, 0)).slice(1)) await completeSet(db, s.id, 8, T0 + 3 * DAY);
    expect(await finishWorkout(db, bad, T0 + 3 * DAY + 3_600_000)).toBe('saved');

    // The bad day is in the history but the progression continues from the last normal session.
    expect((await lastPerformance(db, 'hip-thrust'))?.sets.map((s) => s.weight)).toEqual([40, 40, 40]);
    const next = await startWorkout(db, 'pierna-a', T0 + 6 * DAY);
    expect((await working(next, 0)).map((s) => s.weight)).toEqual([42.5, 42.5, 42.5]);
  });

  it('the −10 % session after a break does not lower the next one either', async () => {
    await history();
    const back = await startWorkout(db, 'pierna-a', T0 + 20 * DAY, { reduceLoads: true });
    expect((await db.workouts.get(back))?.reducedLoads).toBe(true);
    for (const s of await working(back, 0)) await completeSet(db, s.id, 7, T0 + 20 * DAY);
    await finishWorkout(db, back, T0 + 20 * DAY + 3_600_000);
    const next = await startWorkout(db, 'pierna-a', T0 + 23 * DAY);
    expect((await working(next, 0))[0]!.weight).toBe(42.5);
  });

  it('swapping an exercise keeps the −10 % of a deload or return session', async () => {
    // Prensa sentada 3 × 10 @ 100 → next 100; deload → 90.
    const first = await startWorkout(db, 'pierna-a', T0);
    for (const s of await working(first, 1)) {
      await updateSetValues(db, s.id, { weight: 100, reps: 10 });
      await completeSet(db, s.id, 8, T0);
    }
    await finishWorkout(db, first, T0 + 3_600_000);

    await startDeload(db);
    const deload = await startWorkout(db, 'pierna-a', T0 + 3 * DAY);
    const pe = (await loadWorkoutView(db, deload))!.exercises[1]!.performed;
    expect((await working(deload, 1)).map((s) => s.weight)).toEqual([90, 90]);
    await swapExercise(db, pe.id, 'leg-press-45');
    await swapExercise(db, pe.id, 'seated-leg-press');
    expect((await working(deload, 1)).map((s) => s.weight)).toEqual([90, 90]);
  });

  it('ignores a set saved with 0 reps in the history', async () => {
    const id = await startWorkout(db, 'pierna-a', T0);
    const [a, b] = await working(id, 0);
    await updateSetValues(db, a!.id, { weight: 40, reps: 10 });
    await completeSet(db, a!.id, 8, T0);
    await db.sets.update(b!.id, { weight: 40, reps: 0, rpe: 8, completedAt: T0 }); // legacy bad row
    await finishWorkout(db, id, T0 + 3_600_000);
    expect((await lastPerformance(db, 'hip-thrust'))?.sets).toEqual([{ weight: 40, reps: 10, rpe: 8 }]);
  });
});
