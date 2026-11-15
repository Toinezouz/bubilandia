import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, backupFileName, createBackup, markExported, parseBackup, restoreBackup } from '../src/db/backup.ts';
import { AppDatabase, SCHEMA_VERSION } from '../src/db/database.ts';
import { loadHomeData } from '../src/db/home.ts';
import { SETTINGS_ID } from '../src/db/types.ts';
import { completeSet, finishWorkout, loadWorkoutView, setActiveRest, setExerciseNote, startWorkout, updateSetValues } from '../src/db/workouts.ts';
import { shouldRemindBackup } from '../src/engine/reminders.ts';
import { seedIfEmpty } from '../src/seed/seed.ts';

let db: AppDatabase;
const T0 = new Date(2026, 11, 3, 18, 0).getTime();
const DAY = 24 * 3_600_000;

beforeEach(async () => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
  await seedIfEmpty(db);
});
afterEach(async () => {
  await db.delete();
});

/** Two finished sessions + one in progress with a running rest and user edits. */
async function fillWithData() {
  for (const [i, template] of ['pierna-a', 'superior-a'].entries()) {
    const at = T0 + i * 2 * DAY;
    const id = await startWorkout(db, template, at);
    const ex = (await loadWorkoutView(db, id))!.exercises[0]!;
    for (const s of ex.sets) {
      await updateSetValues(db, s.id, { weight: 41.25, reps: 9 });
      await completeSet(db, s.id, 8.5, at + 60_000);
    }
    await setExerciseNote(db, ex.performed.id, 'Asiento 4 · ¡bien!');
    await finishWorkout(db, id, at + 3_600_000, 'Buena sesión');
  }
  const active = await startWorkout(db, 'pierna-b', T0 + 5 * DAY);
  await setActiveRest(db, active, { startedAt: T0 + 5 * DAY, endsAt: T0 + 5 * DAY + 90_000, durationSeconds: 90 });
  await db.exercises.update('hip-thrust', { machineSettings: 'asiento 4, respaldo 2' });
}

async function dump(database: AppDatabase) {
  const sort = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return {
    exercises: sort(await database.exercises.toArray()),
    sessionTemplates: sort(await database.sessionTemplates.toArray()),
    workouts: sort(await database.workouts.toArray()),
    performedExercises: sort(await database.performedExercises.toArray()),
    sets: sort(await database.sets.toArray()),
    settings: sort(await database.settings.toArray()),
  };
}

describe('export → import round trip', () => {
  it('restores exactly the same data, through a JSON file, into a fresh install', async () => {
    await fillWithData();
    const exportedAt = T0 + 6 * DAY;
    const backup = await createBackup(db, exportedAt, '0.1.0');
    await markExported(db, exportedAt);
    const before = await dump(db);
    const text = JSON.stringify(backup);

    // New phone / reinstalled app: only the seeded program.
    const other = new AppDatabase(`test-${crypto.randomUUID()}`);
    await seedIfEmpty(other);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await restoreBackup(other, parsed.backup);

    expect(await dump(other)).toEqual(before);
    await other.delete();
  });

  it('replaces the current data instead of merging', async () => {
    const backup = await createBackup(db, T0, '0.1.0'); // empty history
    await fillWithData();
    await restoreBackup(db, backup);
    expect(await db.workouts.count()).toBe(0);
    expect(await db.sets.count()).toBe(0);
    expect(await db.exercises.count()).toBeGreaterThan(0);
  });

  it('records the export date in the file and in the database', async () => {
    const backup = await createBackup(db, T0, '0.1.0');
    expect(backup).toMatchObject({ format: BACKUP_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: T0, appVersion: '0.1.0' });
    expect(backup.tables.settings[0]!.lastExportAt).toBe(T0);
    expect((await db.settings.get(SETTINGS_ID))?.lastExportAt).toBeNull(); // not saved until delivered
    await markExported(db, T0);
    expect((await db.settings.get(SETTINGS_ID))?.lastExportAt).toBe(T0);
  });

  it('names the file with the date', () => {
    expect(backupFileName(T0)).toBe('bubilandia-fuerza-2026-12-03.json');
  });
});

describe('parseBackup', () => {
  it('previews the content ("2 sesiones, desde el 3 de diciembre")', async () => {
    await fillWithData();
    const result = parseBackup(JSON.stringify(await createBackup(db, T0 + 6 * DAY, '0.1.0')));
    expect(result.ok && result.preview).toEqual({ sessions: 2, since: T0, exportedAt: T0 + 6 * DAY });
  });

  const valid = async () => JSON.parse(JSON.stringify(await createBackup(db, T0, '0.1.0')));

  it.each([
    ['not JSON', () => 'hola', 'no es un JSON'],
    ['another app file', () => JSON.stringify({ foo: 1 }), 'no es una copia'],
  ])('rejects %s', async (_, make, message) => {
    const result = parseBackup(make());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(message);
  });

  it('rejects a backup from a newer app version', async () => {
    const data = await valid();
    data.schemaVersion = SCHEMA_VERSION + 1;
    const result = parseBackup(JSON.stringify(data));
    expect(!result.ok && result.error).toContain('más nueva');
  });

  it('rejects missing tables, broken links and bad values', async () => {
    const missing = await valid();
    delete missing.tables.sets;
    expect(parseBackup(JSON.stringify(missing)).ok).toBe(false);

    await fillWithData();
    const orphan = JSON.parse(JSON.stringify(await createBackup(db, T0, '0.1.0')));
    orphan.tables.performedExercises = [];
    expect(parseBackup(JSON.stringify(orphan)).ok).toBe(false);

    const badValue = JSON.parse(JSON.stringify(await createBackup(db, T0, '0.1.0')));
    badValue.tables.sets[0].weight = 'mucho';
    expect(parseBackup(JSON.stringify(badValue)).ok).toBe(false);

    const noSettings = await valid();
    noSettings.tables.settings = [];
    expect(parseBackup(JSON.stringify(noSettings)).ok).toBe(false);
  });

  it('never touches the database when the file is invalid', async () => {
    await fillWithData();
    const before = await dump(db);
    expect(parseBackup('{"format":"bubilandia-fuerza-backup"}').ok).toBe(false);
    expect(await dump(db)).toEqual(before);
  });
});

describe('backup reminder', () => {
  const base = { hasCompletedSessions: true, lastExportAt: null, dismissedAt: null, now: T0 };

  it('stays quiet while there is nothing to save', () => {
    expect(shouldRemindBackup({ ...base, hasCompletedSessions: false })).toBe(false);
  });

  it('reminds right away when nothing was ever exported', () => {
    expect(shouldRemindBackup(base)).toBe(true);
  });

  it('reminds 14 days after the last export', () => {
    expect(shouldRemindBackup({ ...base, lastExportAt: T0 - 13 * DAY })).toBe(false);
    expect(shouldRemindBackup({ ...base, lastExportAt: T0 - 14 * DAY })).toBe(true);
  });

  it('closing the banner snoozes it for 14 days', () => {
    expect(shouldRemindBackup({ ...base, dismissedAt: T0 - 2 * DAY })).toBe(false);
    expect(shouldRemindBackup({ ...base, dismissedAt: T0 - 15 * DAY })).toBe(true);
  });

  it('is exposed on the home screen data', async () => {
    expect((await loadHomeData(db, T0)).backupReminder).toBe(false);
    await fillWithData();
    expect((await loadHomeData(db, T0 + 6 * DAY)).backupReminder).toBe(true);
    await markExported(db, T0 + 6 * DAY);
    expect((await loadHomeData(db, T0 + 7 * DAY)).backupReminder).toBe(false);
    expect((await loadHomeData(db, T0 + 20 * DAY)).backupReminder).toBe(true);
  });
});
