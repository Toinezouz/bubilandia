import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { createBackup, parseBackup, restoreBackup } from '../src/db/backup.ts';
import { AppDatabase, SCHEMA_VERSION } from '../src/db/database.ts';
import { seedIfEmpty } from '../src/seed/seed.ts';
import { legacyWeeklyTargets } from '../src/seed/settings.ts';

describe('schema v1 → v2', () => {
  it('upgrades an existing install: exercises get isCompound, data is kept', async () => {
    const name = `test-${crypto.randomUUID()}`;

    // An install made with schema v1 (no isCompound), with a user edit.
    const v1 = new Dexie(name);
    v1.version(1).stores({
      exercises: 'id',
      sessionTemplates: 'id, order',
      workouts: 'id, templateId, startedAt, status, [templateId+startedAt]',
      performedExercises: 'id, workoutId, exerciseId, [workoutId+order]',
      sets: 'id, performedExerciseId, completedAt',
      settings: 'id',
    });
    await v1.table('exercises').bulkAdd([
      { id: 'hip-thrust', name: 'Hip thrust', machineSettings: 'asiento 4' },
      { id: 'leg-extension', name: 'Extensión de pierna', machineSettings: '' },
    ]);
    v1.close();

    const db = new AppDatabase(name);
    expect(await db.exercises.get('hip-thrust')).toMatchObject({ isCompound: true, machineSettings: 'asiento 4' });
    expect((await db.exercises.get('leg-extension'))?.isCompound).toBe(false);
    expect(db.verno).toBe(SCHEMA_VERSION);
    await db.delete();
  });

  it('restores a backup made with schema v1', async () => {
    const db = new AppDatabase(`test-${crypto.randomUUID()}`);
    await seedIfEmpty(db);
    const backup = await createBackup(db, Date.now(), '0.1.0');
    // Make it look like a v1 file.
    const v1 = { ...backup, schemaVersion: 1, tables: { ...backup.tables, exercises: backup.tables.exercises.map(({ isCompound: _, ...e }) => e) } };

    const parsed = parseBackup(JSON.stringify(v1));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await restoreBackup(db, parsed.backup);
    expect((await db.exercises.get('romanian-deadlift'))?.isCompound).toBe(true);
    expect((await db.exercises.get('face-pull'))?.isCompound).toBe(false);
    await db.delete();
  });
});

describe('schema v2 → v3 (close to failure)', () => {
  it('moves the old default target RPE 8 to 9, keeps a target she chose', async () => {
    for (const [stored, expected] of [[8, 9], [9.5, 9.5], [10, 10]] as const) {
      const name = `test-${crypto.randomUUID()}`;
      const v2 = new Dexie(name);
      v2.version(2).stores({
        exercises: 'id',
        sessionTemplates: 'id, order',
        workouts: 'id, templateId, startedAt, status, [templateId+startedAt]',
        performedExercises: 'id, workoutId, exerciseId, [workoutId+order]',
        sets: 'id, performedExerciseId, completedAt',
        settings: 'id',
      });
      await v2.table('settings').add({ id: 'settings', targetRPE: stored, soundEnabled: true });
      v2.close();
      const db = new AppDatabase(name);
      expect((await db.settings.get('settings'))?.targetRPE, `stored ${stored}`).toBe(expected);
      expect(db.verno).toBe(SCHEMA_VERSION);
      await db.delete();
    }
  });

  it('a new install starts at RPE 9', async () => {
    const db = new AppDatabase(`test-${crypto.randomUUID()}`);
    await seedIfEmpty(db);
    expect((await db.settings.get('settings'))?.targetRPE).toBe(9);
    await db.delete();
  });

  it('restoring an older backup applies the same change', async () => {
    const db = new AppDatabase(`test-${crypto.randomUUID()}`);
    await seedIfEmpty(db);
    const backup = await createBackup(db, Date.now(), '0.4.0');
    const old = { ...backup, schemaVersion: 2, tables: { ...backup.tables, settings: [{ ...backup.tables.settings[0]!, targetRPE: 8 }] } };
    const parsed = parseBackup(JSON.stringify(old));
    if (!parsed.ok) throw new Error(parsed.error);
    await restoreBackup(db, parsed.backup);
    expect((await db.settings.get('settings'))?.targetRPE).toBe(9);
    await db.delete();
  });
});

describe('schema v3 → v4 (fixed reps)', () => {
  it('turns the original ranges into the fixed numbers, and an edited range into its lower third', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const v3 = new Dexie(name);
    v3.version(3).stores({
      exercises: 'id',
      sessionTemplates: 'id, order',
      workouts: 'id, templateId, startedAt, status, [templateId+startedAt]',
      performedExercises: 'id, workoutId, exerciseId, [workoutId+order]',
      sets: 'id, performedExerciseId, completedAt',
      settings: 'id',
    });
    const item = (order: number, exerciseId: string, repMin: number, repMax: number) => ({
      exerciseId, order, baseSets: 3, optionalExtraSets: 0, repMin, repMax, restSeconds: 90, targetRPE: null,
    });
    await v3.table('sessionTemplates').add({
      id: 'pierna-a', name: 'Pierna A', code: 'A', order: 0, isLegDay: true,
      items: [item(0, 'hip-thrust', 6, 10), item(1, 'hip-abduction', 12, 20), item(2, 'leg-extension', 8, 14), item(3, 'plank', 30, 45)],
    });
    v3.close();

    const db = new AppDatabase(name);
    const items = (await db.sessionTemplates.get('pierna-a'))!.items;
    expect(items.map((i) => [i.exerciseId, i.repMin, i.repMax])).toEqual([
      ['hip-thrust', 8, 8],
      ['hip-abduction', 15, 15],
      ['leg-extension', 10, 10], // range she edited (8-14) → lower third
      ['plank', 40, 40],
    ]);
    await db.delete();
  });
});

describe('schema v4 → v5 (weekly targets follow the program)', () => {
  async function v4WithTargets(targets: Record<string, { min: number; max: number }>) {
    const name = `test-${crypto.randomUUID()}`;
    const fresh = new AppDatabase(`seed-${crypto.randomUUID()}`);
    await seedIfEmpty(fresh);
    const exercises = await fresh.exercises.toArray();
    const templates = await fresh.sessionTemplates.toArray();
    await fresh.delete();
    const v4 = new Dexie(name);
    v4.version(4).stores({
      exercises: 'id',
      sessionTemplates: 'id, order',
      workouts: 'id, templateId, startedAt, status, [templateId+startedAt]',
      performedExercises: 'id, workoutId, exerciseId, [workoutId+order]',
      sets: 'id, performedExerciseId, completedAt',
      settings: 'id',
    });
    await v4.table('exercises').bulkAdd(exercises);
    await v4.table('sessionTemplates').bulkAdd(templates);
    await v4.table('settings').add({ id: 'settings', targetRPE: 9, weeklySetTargets: targets });
    v4.close();
    return new AppDatabase(name);
  }

  it('replaces the generic 8-10 targets with what the program plans', async () => {
    const db = await v4WithTargets(legacyWeeklyTargets());
    const t = (await db.settings.get('settings'))!.weeklySetTargets;
    expect(t.glutes).toEqual({ min: 15, max: 17 });
    expect(t.chest).toEqual({ min: 3, max: 3 });
    expect(t.adductors).toEqual({ min: 2, max: 3 });
    await db.delete();
  });

  it('keeps targets she changed herself', async () => {
    const custom = { ...legacyWeeklyTargets(), chest: { min: 6, max: 8 } };
    const db = await v4WithTargets(custom);
    expect((await db.settings.get('settings'))!.weeklySetTargets.chest).toEqual({ min: 6, max: 8 });
    await db.delete();
  });
});
