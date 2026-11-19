import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '../src/db/database.ts';
import {
  addItem,
  addTemplateItem,
  createExercise,
  moveItem,
  moveTemplateItem,
  patchItem,
  removeItem,
  removeTemplateItem,
  updateExercise,
  updateExerciseIncrement,
  updateTemplateItem,
  validateExerciseDraft,
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
    expect(added.at(-1)).toMatchObject({ exerciseId: 'plank', order: 3, baseSets: 3, repMin: 30, repMax: 30, restSeconds: 60 });
  });

  it('keeps values sane when editing', () => {
    expect(patchItem(legA, 0, { repMin: 12, repMax: 10 })[0]).toMatchObject({ repMin: 12, repMax: 12 });
    expect(patchItem(legA, 0, { repMin: 10, repMax: 10 })[0]).toMatchObject({ repMin: 10, repMax: 10 }); // fixed reps
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

describe('custom exercises', () => {
  let db: AppDatabase;
  beforeEach(async () => {
    db = new AppDatabase(`test-${crypto.randomUUID()}`);
    await seedIfEmpty(db);
  });
  afterEach(async () => {
    await db.delete();
  });

  const draft = {
    name: '  Sentadilla con barra ',
    primaryMuscle: 'quads' as const,
    secondaryMuscle: 'glutes' as const,
    kind: 'weighted' as const,
    isUnilateral: false,
    isCompound: true,
    defaultRestSeconds: 150,
  };

  it('validates the draft', () => {
    expect(validateExerciseDraft(draft, [])).toBeNull();
    expect(validateExerciseDraft({ ...draft, name: ' ' }, [])).toContain('nombre');
    expect(validateExerciseDraft(draft, ['sentadilla con BARRA'])).toContain('Ya existe');
    expect(validateExerciseDraft({ ...draft, secondaryMuscle: 'quads' }, [])).toContain('secundario');
  });

  it('creates an exercise that can be added to a session and trained', async () => {
    const id = await createExercise(db, draft);
    expect(await db.exercises.get(id)).toMatchObject({
      name: 'Sentadilla con barra',
      primaryMuscle: 'quads',
      secondaryMuscle: 'glutes',
      kind: 'weighted',
      isCompound: true,
      increment: 2.5,
      defaultRestSeconds: 150,
      cues: [],
      alternativeIds: [],
    });
    await addTemplateItem(db, 'pierna-a', id);
    const workout = await startWorkout(db, 'pierna-a', Date.now());
    const view = (await loadWorkoutView(db, workout))!;
    expect(view.exercises.at(-1)!.exercise.name).toBe('Sentadilla con barra');
    expect(view.exercises.at(-1)!.sets).toHaveLength(3);
  });

  it('timed exercises step in seconds and are never compound', async () => {
    const id = await createExercise(db, { ...draft, name: 'Plancha lateral', kind: 'timed', primaryMuscle: 'core', secondaryMuscle: null });
    expect(await db.exercises.get(id)).toMatchObject({ kind: 'timed', increment: 5, isCompound: false });
  });

  it('renames an exercise and keeps its history, type and load step', async () => {
    await updateExerciseIncrement(db, 'hip-thrust', 5);
    await updateExercise(db, 'hip-thrust', { ...draft, name: 'Hip thrust con barra', primaryMuscle: 'glutes', secondaryMuscle: null });
    expect(await db.exercises.get('hip-thrust')).toMatchObject({
      id: 'hip-thrust',
      name: 'Hip thrust con barra',
      kind: 'weighted',
      increment: 5,
      secondaryMuscle: null,
    });
    expect((await db.exercises.get('hip-thrust'))!.cues.length).toBeGreaterThan(0); // untouched
  });
});
