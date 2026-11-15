import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '../src/db/database.ts';
import { loadHomeData } from '../src/db/home.ts';
import { SETTINGS_ID } from '../src/db/types.ts';
import {
  completeSet,
  endDeload,
  finishWorkout,
  lastPerformance,
  loadWorkoutView,
  snoozeDeload,
  startDeload,
  startWorkout,
  updateSetValues,
} from '../src/db/workouts.ts';
import { seedIfEmpty } from '../src/seed/seed.ts';

let db: AppDatabase;
const DAY = 24 * 3_600_000;
const T0 = new Date(2026, 0, 5, 18).getTime();

beforeEach(async () => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  await seedIfEmpty(db);
  await db.settings.update(SETTINGS_ID, { warmupEnabled: false });
});
afterEach(async () => {
  await db.delete();
});

/** Pierna A with hip thrust 3 × 10 @ 50 kg. */
async function legDay(at: number) {
  const id = await startWorkout(db, 'pierna-a', at);
  for (const s of (await loadWorkoutView(db, id))!.exercises[0]!.sets) {
    await updateSetValues(db, s.id, { weight: 50, reps: 10 });
    await completeSet(db, s.id, 8, at);
  }
  await finishWorkout(db, id, at + 3_600_000);
  return id;
}

describe('deload week', () => {
  it('4 sessions with one set less and −10 %, excluded from progression', async () => {
    await legDay(T0);
    await startDeload(db);
    expect((await loadHomeData(db, T0 + DAY)).deloadRemaining).toBe(4);

    const id = await startWorkout(db, 'pierna-a', T0 + 2 * DAY);
    const view = (await loadWorkoutView(db, id))!;
    expect(view.workout.isDeload).toBe(true);
    const hip = view.exercises[0]!.sets;
    expect(hip).toHaveLength(2); // 3 → 2 sets
    expect(hip[0]!.weight).toBe(47.5); // suggestion 52,5 → −10 % = 47,25 → 47,5
    for (const s of hip) await completeSet(db, s.id, 6, T0 + 2 * DAY);
    await finishWorkout(db, id, T0 + 2 * DAY + 3_600_000);

    expect((await db.settings.get(SETTINGS_ID))?.deloadRemaining).toBe(3);
    // The next real session still progresses from the last non-deload one (50 kg).
    expect((await lastPerformance(db, 'hip-thrust'))?.sets[0]?.weight).toBe(50);
  });

  it('can be ended early', async () => {
    await startDeload(db);
    await endDeload(db);
    const id = await startWorkout(db, 'pierna-a', T0);
    expect((await db.workouts.get(id))?.isDeload).toBe(false);
  });

  it('is proposed on the home screen after 6 weeks, and "Ahora no" snoozes it', async () => {
    for (let day = 0; day <= 42; day += 3) await legDay(T0 + day * DAY);
    const now = T0 + 43 * DAY;
    expect((await loadHomeData(db, now)).deloadProposal).toBe('duration');
    await snoozeDeload(db, now);
    expect((await loadHomeData(db, now)).deloadProposal).toBeNull();
    await startDeload(db);
    expect((await loadHomeData(db, now + 8 * DAY)).deloadProposal).toBeNull(); // deload in progress
  });
});

describe('return after a break', () => {
  it('reduceLoads lowers this session by ~10 %', async () => {
    await legDay(T0);
    const id = await startWorkout(db, 'pierna-a', T0 + 15 * DAY, { reduceLoads: true });
    const view = (await loadWorkoutView(db, id))!;
    expect(view.workout.isDeload).toBe(false);
    expect(view.exercises[0]!.sets.map((s) => s.weight)).toEqual([47.5, 47.5, 47.5]);
  });

  it('home data exposes what the break check needs', async () => {
    await legDay(T0);
    const home = await loadHomeData(db, T0 + 15 * DAY);
    expect(home.sessionStarts).toEqual([T0]);
    expect(home.lastStartByTemplate['pierna-a']).toBe(T0);
  });
});
