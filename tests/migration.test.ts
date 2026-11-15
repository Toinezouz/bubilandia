import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { createBackup, parseBackup, restoreBackup } from '../src/db/backup.ts';
import { AppDatabase, SCHEMA_VERSION } from '../src/db/database.ts';
import { seedIfEmpty } from '../src/seed/seed.ts';

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
