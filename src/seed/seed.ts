import type { AppDatabase } from '../db/database.ts';
import { SEED_EXERCISES } from './exercises.ts';
import { defaultSettings } from './settings.ts';
import { SEED_TEMPLATES } from './templates.ts';

/**
 * Loads the initial program on first launch. Idempotent and atomic: it only writes when
 * the settings row is missing, inside one transaction, so a reload mid-seed cannot leave
 * half a program and a second call (StrictMode, two tabs) does nothing.
 *
 * @returns true if the program was written, false if the database was already initialised.
 */
export async function seedIfEmpty(db: AppDatabase): Promise<boolean> {
  return db.transaction('rw', [db.exercises, db.sessionTemplates, db.settings], async () => {
    if (await db.settings.count()) return false;
    await db.exercises.bulkPut(SEED_EXERCISES);
    await db.sessionTemplates.bulkPut(SEED_TEMPLATES);
    await db.settings.put(defaultSettings());
    return true;
  });
}
