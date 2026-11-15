import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '../src/db/database.ts';
import { listHistory, loadWorkoutSummary } from '../src/db/summary.ts';
import { completeSet, finishWorkout, loadWorkoutView, startWorkout, updateSetValues } from '../src/db/workouts.ts';
import { seedIfEmpty } from '../src/seed/seed.ts';
import { formatDate, formatDuration, formatVolume } from '../src/shared/format.ts';

let db: AppDatabase;
const T0 = new Date(2026, 10, 10, 18, 0).getTime();
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

beforeEach(async () => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  await seedIfEmpty(db);
});
afterEach(async () => {
  await db.delete();
});

/** Hip thrust only: each entry = one completed set. Returns the workout id (in progress). */
async function hipThrust(at: number, sets: Array<[number, number, number]>) {
  const id = await startWorkout(db, 'pierna-a', at);
  const ex = (await loadWorkoutView(db, id))!.exercises[0]!;
  for (const [i, [weight, reps, rpe]] of sets.entries()) {
    const setId = ex.sets.filter((x) => !x.isWarmup)[i]!.id;
    await updateSetValues(db, setId, { weight, reps });
    await completeSet(db, setId, rpe, at + (i + 1) * MIN);
  }
  return id;
}

describe('loadWorkoutSummary', () => {
  it('sums up duration, sets, volume and pending sets of the session in progress', async () => {
    const id = await hipThrust(T0, [
      [40, 10, 8],
      [40, 10, 8.5],
    ]);
    const s = (await loadWorkoutSummary(db, id, T0 + 52 * MIN))!;
    expect(s).toMatchObject({
      templateName: 'Pierna A',
      templateCode: 'A',
      durationMs: 52 * MIN,
      setCount: 2,
      exerciseCount: 1,
      volumeKg: 800,
      records: [],
    });
    // 1 hip thrust set left + 3 sets for each of the 3 other exercises.
    expect(s.pendingSets).toBe(10);
  });

  it('lists records beaten compared with earlier sessions', async () => {
    await finishWorkout(db, await hipThrust(T0, [[40, 10, 8], [40, 10, 8], [40, 9, 9]]), T0 + 60 * MIN);
    const id = await hipThrust(T0 + 3 * DAY, [[45, 8, 9], [45, 7, 9.5]]);
    const s = (await loadWorkoutSummary(db, id, T0 + 3 * DAY + 50 * MIN))!;
    expect(s.records).toHaveLength(1);
    expect(s.records[0]!.exerciseName).toBe('Hip thrust');
    expect(s.records[0]!.records).toContainEqual({ type: 'weight_for_reps', weight: 45, reps: 8 });
  });

  it('uses the end time once finished', async () => {
    const id = await hipThrust(T0, [[40, 10, 8]]);
    await finishWorkout(db, id, T0 + 65 * MIN);
    const s = (await loadWorkoutSummary(db, id, T0 + 10 * DAY))!;
    expect(s.durationMs).toBe(65 * MIN);
    expect(s.pendingSets).toBe(0);
  });
});

describe('listHistory', () => {
  it('lists finished workouts newest first, ignoring the one in progress', async () => {
    await finishWorkout(db, await hipThrust(T0, [[40, 10, 8]]), T0 + 40 * MIN);
    await finishWorkout(db, await hipThrust(T0 + 3 * DAY, [[42.5, 8, 8], [42.5, 8, 8]]), T0 + 3 * DAY + 45 * MIN);
    await hipThrust(T0 + 6 * DAY, [[45, 6, 9]]);

    const history = await listHistory(db);
    expect(history.map((h) => [h.setCount, h.volumeKg, h.durationMs])).toEqual([
      [2, 680, 45 * MIN],
      [1, 400, 40 * MIN],
    ]);
    expect(history[0]!.templateName).toBe('Pierna A');
  });
});

describe('summary formatting', () => {
  it('formats durations, dates and volume in Spanish', () => {
    expect(formatDuration(52 * MIN)).toBe('52 min');
    expect(formatDuration(65 * MIN)).toBe('1 h 05 min');
    expect(formatVolume(12450)).toBe('12.450 kg');
    expect(formatDate(T0, T0)).toBe('mar, 10 nov');
    expect(formatDate(T0, new Date(2027, 0, 5).getTime())).toBe('mar, 10 nov 2026');
  });
});
