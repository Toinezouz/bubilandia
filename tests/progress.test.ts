import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '../src/db/database.ts';
import { listTrainedExercises, loadExerciseProgress, loadWeeklyVolume, weekStart } from '../src/db/progress.ts';
import { SETTINGS_ID } from '../src/db/types.ts';
import { completeSet, finishWorkout, loadWorkoutView, startWorkout, updateSetValues } from '../src/db/workouts.ts';
import { seedIfEmpty } from '../src/seed/seed.ts';

let db: AppDatabase;
const DAY = 24 * 3_600_000;
const MON = new Date(2026, 10, 2, 18).getTime(); // Monday 2 Nov 2026

beforeEach(async () => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  await seedIfEmpty(db);
  await db.settings.update(SETTINGS_ID, { warmupEnabled: false });
});
afterEach(async () => {
  await db.delete();
});

/** Pierna A, hip thrust sets as [weight, reps, rpe]; the other exercises untouched. */
async function hip(at: number, sets: Array<[number, number, number]>, isDeload = false) {
  const id = await startWorkout(db, 'pierna-a', at);
  const rows = (await loadWorkoutView(db, id))!.exercises[0]!.sets;
  for (const [i, [weight, reps, rpe]] of sets.entries()) {
    await updateSetValues(db, rows[i]!.id, { weight, reps });
    await completeSet(db, rows[i]!.id, rpe, at);
  }
  if (isDeload) await db.workouts.update(id, { isDeload: true });
  await finishWorkout(db, id, at + 3_600_000);
}

describe('loadExerciseProgress', () => {
  it('lists sessions oldest first with e1RM, volume and records', async () => {
    await hip(MON, [[40, 10, 8], [40, 9, 9]]);
    await hip(MON + 3 * DAY, [[45, 8, 9], [42.5, 10, 9]]);

    const p = (await loadExerciseProgress(db, 'hip-thrust'))!;
    expect(p.sessions.map((s) => s.at)).toEqual([MON, MON + 3 * DAY]);
    expect(p.sessions[0]!.e1rm).toBeCloseTo(56, 6); // 40 × (1 + 12/30)
    expect(p.sessions[1]!.volumeKg).toBe(45 * 8 + 42.5 * 10);
    // 45 × 8 @ 9 → 45 × (1 + 9/30) = 58,5 beats 42,5 × 10 @ 9 → 58,08
    expect(p.bestE1RM).toMatchObject({ weight: 45, reps: 8 });
    expect(p.bestE1RM!.value).toBeCloseTo(58.5, 6);
    // Heaviest load for at least N reps.
    expect(p.bestByReps).toEqual([
      { reps: 8, weight: 45, at: MON + 3 * DAY },
      { reps: 9, weight: 42.5, at: MON + 3 * DAY }, // 42,5 × 10 also counts for 9
      { reps: 10, weight: 42.5, at: MON + 3 * DAY },
    ]);
    expect(p.stagnating).toBe(false);
  });

  it('flags stagnation over 3 sessions, ignoring deload sessions', async () => {
    await hip(MON, [[50, 10, 8]]);
    await hip(MON + 2 * DAY, [[50, 9, 8]]);
    await hip(MON + 4 * DAY, [[40, 10, 6]], true); // deload: ignored
    await hip(MON + 6 * DAY, [[50, 10, 8]]);
    await hip(MON + 8 * DAY, [[50, 9, 8.5]]);
    expect((await loadExerciseProgress(db, 'hip-thrust'))!.stagnating).toBe(true);
  });
});

describe('listTrainedExercises', () => {
  it('lists exercises with completed sets, most recent first', async () => {
    await hip(MON, [[40, 10, 8]]);
    const rows = await listTrainedExercises(db);
    expect(rows.map((r) => [r.exercise.id, r.sessions])).toEqual([['hip-thrust', 1]]);
  });
});

describe('loadWeeklyVolume', () => {
  it('groups working sets per muscle and calendar week (Monday start)', async () => {
    expect(weekStart(MON + 5 * DAY)).toBe(new Date(2026, 10, 2).getTime()); // Saturday → Monday
    await hip(MON - 7 * DAY, [[40, 10, 8]]); // previous week
    await hip(MON, [[40, 10, 8], [40, 10, 8]]);
    await hip(MON + 3 * DAY, [[40, 10, 8]]);

    const weeks = await loadWeeklyVolume(db, MON + 4 * DAY, 8);
    expect(weeks).toHaveLength(8);
    expect(weeks.at(-1)!.weekStart).toBe(new Date(2026, 10, 2).getTime());
    expect(weeks.at(-1)!.setsByMuscle.glutes).toBe(3);
    expect(weeks.at(-2)!.setsByMuscle.glutes).toBe(1);
    expect(weeks[0]!.setsByMuscle.glutes).toBe(0);
  });
});
