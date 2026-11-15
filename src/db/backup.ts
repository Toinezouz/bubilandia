/**
 * Backups (§6.5): everything lives on the phone only, so a JSON file of the whole database is
 * the safety net. Export → file; import → validate, preview, then replace all data.
 */

import { SCHEMA_VERSION, TABLE_NAMES, type AppDatabase } from './database.ts';
import {
  SETTINGS_ID,
  type Exercise,
  type PerformedExercise,
  type SessionTemplate,
  type SetEntry,
  type Settings,
  type Workout,
} from './types.ts';

export const BACKUP_FORMAT = 'bubilandia-fuerza-backup';

export interface BackupTables {
  exercises: Exercise[];
  sessionTemplates: SessionTemplate[];
  workouts: Workout[];
  performedExercises: PerformedExercise[];
  sets: SetEntry[];
  settings: Settings[];
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: number;
  appVersion: string;
  exportedAt: number;
  tables: BackupTables;
}

export interface BackupPreview {
  /** Completed sessions in the file. */
  sessions: number;
  /** Start of the oldest completed session, null if none. */
  since: number | null;
  exportedAt: number;
}

/**
 * Snapshot of every table. The exported settings already carry `lastExportAt = exportedAt`;
 * the caller writes the same value to the database once the file was actually saved/shared
 * (`markExported`), so database and file stay identical.
 */
export async function createBackup(db: AppDatabase, now: number, appVersion: string): Promise<BackupFile> {
  return db.transaction('r', TABLE_NAMES.map((t) => db.table(t)), async () => {
    const [exercises, sessionTemplates, workouts, performedExercises, sets, settings] = await Promise.all([
      db.exercises.toArray(),
      db.sessionTemplates.toArray(),
      db.workouts.toArray(),
      db.performedExercises.toArray(),
      db.sets.toArray(),
      db.settings.toArray(),
    ]);
    return {
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      appVersion,
      exportedAt: now,
      tables: {
        exercises,
        sessionTemplates,
        workouts,
        performedExercises,
        sets,
        settings: settings.map((s) => ({ ...s, lastExportAt: now, backupReminderDismissedAt: null })),
      },
    };
  });
}

export async function markExported(db: AppDatabase, exportedAt: number): Promise<void> {
  await db.settings.update(SETTINGS_ID, { lastExportAt: exportedAt, backupReminderDismissedAt: null });
}

export function backupFileName(exportedAt: number): string {
  const d = new Date(exportedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `bubilandia-fuerza-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

export function previewBackup(backup: BackupFile): BackupPreview {
  const done = backup.tables.workouts.filter((w) => w.status === 'done');
  return {
    sessions: done.length,
    since: done.length ? Math.min(...done.map((w) => w.startedAt)) : null,
    exportedAt: backup.exportedAt,
  };
}

export type ParseResult = { ok: true; backup: BackupFile; preview: BackupPreview } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasStringId = (v: unknown) => isObject(v) && typeof v.id === 'string' && v.id !== '';

/**
 * Validates an imported file. Messages are in Spanish (shown as-is). It checks the envelope,
 * every table, the key fields and the links between rows, so a bad file never wipes good data.
 */
export function parseBackup(text: string): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error });

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fail('El archivo no es un JSON válido.');
  }
  if (!isObject(data) || data.format !== BACKUP_FORMAT) {
    return fail('Este archivo no es una copia de seguridad de Bubilandia fuerza.');
  }
  if (typeof data.schemaVersion !== 'number' || !Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) {
    return fail('La copia no indica una versión válida.');
  }
  if (data.schemaVersion > SCHEMA_VERSION) {
    return fail('Esta copia viene de una versión más nueva de la app. Actualiza la app y vuelve a intentarlo.');
  }
  if (typeof data.exportedAt !== 'number' || !isObject(data.tables)) return fail('La copia está incompleta.');

  const tables = data.tables;
  for (const name of TABLE_NAMES) {
    const rows = tables[name];
    if (!Array.isArray(rows)) return fail(`Falta la tabla «${name}».`);
    if (!rows.every(hasStringId)) return fail(`La tabla «${name}» tiene filas sin identificador.`);
    if (new Set(rows.map((r: { id: string }) => r.id)).size !== rows.length) return fail(`La tabla «${name}» tiene identificadores repetidos.`);
  }
  const t = tables as unknown as BackupTables;

  if (t.exercises.length === 0 || t.sessionTemplates.length === 0) return fail('La copia no contiene el programa.');
  if (t.settings.length !== 1 || t.settings[0]!.id !== SETTINGS_ID) return fail('La copia no contiene los ajustes.');

  const statuses = new Set(['in_progress', 'done', 'abandoned']);
  if (!t.workouts.every((w) => typeof w.startedAt === 'number' && statuses.has(w.status) && typeof w.templateId === 'string')) {
    return fail('Hay sesiones con datos no válidos.');
  }
  if (t.workouts.filter((w) => w.status === 'in_progress').length > 1) return fail('Hay varias sesiones en curso.');

  const workoutIds = new Set(t.workouts.map((w) => w.id));
  const exerciseIds = new Set(t.exercises.map((e) => e.id));
  if (!t.performedExercises.every((p) => workoutIds.has(p.workoutId) && exerciseIds.has(p.exerciseId))) {
    return fail('Hay ejercicios que apuntan a sesiones o ejercicios inexistentes.');
  }
  const performedIds = new Set(t.performedExercises.map((p) => p.id));
  const validNumber = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
  if (!t.sets.every((s) => performedIds.has(s.performedExerciseId) && validNumber(s.weight) && validNumber(s.reps) && validNumber(s.rpe))) {
    return fail('Hay series con datos no válidos.');
  }

  const backup = data as unknown as BackupFile;
  return { ok: true, backup, preview: previewBackup(backup) };
}

/** Replaces every table with the backup content, atomically (all or nothing). */
export async function restoreBackup(db: AppDatabase, backup: BackupFile): Promise<void> {
  // Only schema 1 exists so far; future versions migrate older backups here before writing.
  const t = backup.tables;
  await db.transaction('rw', TABLE_NAMES.map((name) => db.table(name)), async () => {
    await Promise.all(TABLE_NAMES.map((name) => db.table(name).clear()));
    await db.exercises.bulkAdd(t.exercises);
    await db.sessionTemplates.bulkAdd(t.sessionTemplates);
    await db.workouts.bulkAdd(t.workouts);
    await db.performedExercises.bulkAdd(t.performedExercises);
    await db.sets.bulkAdd(t.sets);
    await db.settings.bulkAdd(t.settings);
  });
}
