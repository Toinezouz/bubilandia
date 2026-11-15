import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from '../src/db/database.ts';
import { MUSCLES, SETTINGS_ID } from '../src/db/types.ts';
import { SEED_EXERCISES } from '../src/seed/exercises.ts';
import { seedIfEmpty } from '../src/seed/seed.ts';
import { SEED_TEMPLATES } from '../src/seed/templates.ts';

let db: AppDatabase;

beforeEach(() => {
  db = new AppDatabase(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  await db.delete();
});

describe('seedIfEmpty', () => {
  it('loads the program on first launch', async () => {
    expect(await seedIfEmpty(db)).toBe(true);
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length);
    expect(await db.sessionTemplates.count()).toBe(4);

    const settings = await db.settings.get(SETTINGS_ID);
    expect(settings?.targetRPE).toBe(8);
    expect(settings?.weeklySetTargets.glutes).toEqual({ min: 15, max: 15 });
    expect(settings?.weeklySetTargets.back).toEqual({ min: 8, max: 10 });
  });

  it('does nothing on later launches and keeps user edits', async () => {
    await seedIfEmpty(db);
    await db.exercises.update('hip-thrust', { machineSettings: 'asiento 4' });

    expect(await seedIfEmpty(db)).toBe(false);
    expect((await db.exercises.get('hip-thrust'))?.machineSettings).toBe('asiento 4');
  });

  it('is safe when called twice concurrently', async () => {
    const results = await Promise.all([seedIfEmpty(db), seedIfEmpty(db)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await db.sessionTemplates.count()).toBe(4);
  });

  it('keeps the rotation order A → B → C → D', async () => {
    await seedIfEmpty(db);
    const codes = (await db.sessionTemplates.orderBy('order').toArray()).map((t) => t.code);
    expect(codes).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('seed data integrity', () => {
  const byId = new Map(SEED_EXERCISES.map((e) => [e.id, e]));

  it('has unique exercise ids', () => {
    expect(byId.size).toBe(SEED_EXERCISES.length);
  });

  it('references only existing exercises from templates and alternatives', () => {
    for (const template of SEED_TEMPLATES) {
      for (const item of template.items) expect(byId.has(item.exerciseId), item.exerciseId).toBe(true);
    }
    for (const exercise of SEED_EXERCISES) {
      for (const altId of exercise.alternativeIds) {
        expect(byId.has(altId), `${exercise.id} → ${altId}`).toBe(true);
        expect(altId).not.toBe(exercise.id);
      }
    }
  });

  it('gives every exercise valid muscles, cues and a positive increment', () => {
    for (const e of SEED_EXERCISES) {
      expect(MUSCLES).toContain(e.primaryMuscle);
      if (e.secondaryMuscle) expect(MUSCLES).toContain(e.secondaryMuscle);
      expect(e.cues.length, e.id).toBeGreaterThanOrEqual(2);
      expect(e.increment, e.id).toBeGreaterThan(0);
    }
  });

  it('has coherent template items', () => {
    for (const template of SEED_TEMPLATES) {
      template.items.forEach((item, index) => {
        expect(item.order).toBe(index);
        expect(item.repMin).toBeLessThan(item.repMax);
        expect(item.baseSets).toBeGreaterThanOrEqual(2);
      });
    }
  });

  it('shares the dumbbell curl and cable tríceps between sessions B and D', () => {
    const ids = (code: string) => SEED_TEMPLATES.find((t) => t.code === code)!.items.map((i) => i.exerciseId);
    for (const id of ['biceps-curl', 'cable-triceps']) {
      expect(ids('B'), id).toContain(id);
      expect(ids('D'), id).toContain(id);
    }
    expect(byId.get('biceps-curl')?.name).toBe('Curl de bíceps con mancuernas');
    expect(byId.get('cable-triceps')?.name).toBe('Tríceps en polea');

    const all = SEED_TEMPLATES.flatMap((t) => t.items.map((i) => i.exerciseId));
    expect(new Set(all).size).toBe(23);
  });

  it('matches the program of §4', () => {
    const summary = SEED_TEMPLATES.map((t) => [t.code, t.items.length]);
    expect(summary).toEqual([['A', 4], ['B', 7], ['C', 6], ['D', 8]]);

    const hipThrust = SEED_TEMPLATES[0]!.items[0]!;
    expect(hipThrust).toMatchObject({ exerciseId: 'hip-thrust', baseSets: 3, optionalExtraSets: 0, repMin: 6, repMax: 10, restSeconds: 150 });

    const curlB = SEED_TEMPLATES[1]!.items[5]!;
    expect(curlB).toMatchObject({ exerciseId: 'biceps-curl',baseSets: 2, optionalExtraSets: 1 });

    const plank = SEED_TEMPLATES[3]!.items[6]!;
    expect(plank).toMatchObject({ exerciseId: 'plank', repMin: 30, repMax: 45 });
    expect(byId.get('plank')?.kind).toBe('timed');

    for (const id of ['single-leg-press', 'cable-kickback', 'single-arm-machine-row']) {
      expect(byId.get(id)?.isUnilateral, id).toBe(true);
    }
    expect(byId.get('cable-kickback')?.increment).toBe(1.25);
    expect(byId.get('seated-leg-press')?.increment).toBe(5);
    expect(SEED_TEMPLATES.filter((t) => t.isLegDay).map((t) => t.code)).toEqual(['A', 'C']);
  });
});
