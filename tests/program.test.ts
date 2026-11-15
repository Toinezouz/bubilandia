import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '../src/db/database.ts';
import {
  addItem,
  addTemplateItem,
  moveItem,
  moveTemplateItem,
  patchItem,
  removeItem,
  removeTemplateItem,
  updateExerciseIncrement,
  updateTemplateItem,
} from '../src/db/program.ts';
import { deleteWorkout, loadWorkoutView, startWorkout, completeSet, updateSetValues, finishWorkout } from '../src/db/workouts.ts';
import { SEED_EXERCISES } from '../src/seed/exercises.ts';
import { seedIfEmpty } from '../src/seed/seed.ts';
import { SEED_TEMPLATES } from '../src/seed/templates.ts';

const legA = SEED_TEMPLATES[0]!.items; // hip thrust, prensa, extensión, abducción

describe('program list helpers', () => {
  it('moves items and keeps the order contiguous', () => {
    const moved = moveItem(legA, 2, -1);
    expect(moved.map((i) => i.exerciseId)).toEqual(['hip-thrust', 'leg-extension', 'seated-leg-press', 'hip-abduction']);
    expect(moved.map((i) => i.order)).toEqual([0, 1, 2, 3]);
    expect(moveItem(legA, 0, -1).map((i) => i.exerciseId)).toEqual(legA.map((i) => i.exerciseId)); // already first
  });

  it('removes and adds items', () => {
    const removed = removeItem(legA, 1);
    expect(removed.map((i) => [i.exerciseId, i.order])).toEqual([
      ['hip-thrust', 0],
      ['leg-extension', 1],
      ['hip-abduction', 2],
    ]);
    const plank = SEED_EXERCISES.find((e) => e.id === 'plank')!;
    const added = addItem(removed, plank);
    expect(added.at(-1)).toMatchObject({ exerciseId: 'plank', order: 3, baseSets: 3, repMin: 30, repMax: 45, restSeconds: 60 });
  });

  it('keeps values sane when editing', () => {
    expect(patchItem(legA, 0, { repMin: 12, repMax: 10 })[0]).toMatchObject({ repMin: 12, repMax: 13 });
    expect(patchItem(legA, 0, { baseSets: 0 })[0]!.baseSets).toBe(1);
    expect(patchItem(legA, 0, { restSeconds: -15 })[0]!.restSeconds).toBe(0);
    expect(patchItem(legA, 0, { order: 3, baseSets: 4 })[0]).toMatchObject({ order: 0, baseSets: 4 }); // order not patchable
  });
});

describe('program editing in the database', () => {
  let db: AppDatabase;
  beforeEach(async () => {
    db = new AppDatabase(`test-${crypto.randomUUID()}`);
    await seedIfEmpty(db);
  });
  afterEach(async () => {
    await db.delete();
  });

  it('changes are used by the next workout', async () => {
    await updateTemplateItem(db, 'pierna-a', 0, { baseSets: 4, repMin: 8, repMax: 12, restSeconds: 180 });
    await moveTemplateItem(db, 'pierna-a', 3, -1);
    await removeTemplateItem(db, 'pierna-a', 1);
    await addTemplateItem(db, 'pierna-a', 'hip-adduction');

    const id = await startWorkout(db, 'pierna-a', Date.now());
    const view = (await loadWorkoutView(db, id))!;
    expect(view.exercises.map((e) => e.exercise.id)).toEqual(['hip-thrust', 'hip-abduction', 'leg-extension', 'hip-adduction']);
    expect(view.exercises[0]!.sets.filter((s) => !s.isWarmup)).toHaveLength(4);
    expect(view.exercises[0]!.item).toMatchObject({ repMin: 8, repMax: 12, restSeconds: 180 });
  });

  it('changes the load step of an exercise everywhere', async () => {
    await updateExerciseIncrement(db, 'biceps-curl', 2);
    expect((await db.exercises.get('biceps-curl'))?.increment).toBe(2);
    await updateExerciseIncrement(db, 'biceps-curl', 0); // ignored
    expect((await db.exercises.get('biceps-curl'))?.increment).toBe(2);
    await updateExerciseIncrement(db, 'biceps-curl', 1.5);
    expect((await db.exercises.get('biceps-curl'))?.increment).toBe(1.5);
    await updateExerciseIncrement(db, 'biceps-curl', 0.1 + 0.2); // float noise → 0,3
    expect((await db.exercises.get('biceps-curl'))?.increment).toBe(0.3);
  });

  it('deletes a past session completely', async () => {
    const id = await startWorkout(db, 'pierna-a', Date.now());
    const set = (await loadWorkoutView(db, id))!.exercises[0]!.sets[0]!;
    await updateSetValues(db, set.id, { weight: 40 });
    await completeSet(db, set.id, 8, Date.now());
    await finishWorkout(db, id, Date.now());
    await deleteWorkout(db, id);
    expect(await db.workouts.count()).toBe(0);
    expect(await db.performedExercises.count()).toBe(0);
    expect(await db.sets.count()).toBe(0);
  });
});
