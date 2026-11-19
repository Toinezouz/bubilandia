/**
 * Program editing (§6.6). Pure list helpers (testable without a database) + small DB writes.
 * Template items always keep a contiguous `order` 0..n-1.
 */

import { newId } from '../shared/id.ts';
import type { AppDatabase } from './database.ts';
import type { Exercise, ExerciseKind, Muscle, TemplateItem } from './types.ts';

const renumber = (items: TemplateItem[]): TemplateItem[] =>
  [...items].sort((a, b) => a.order - b.order).map((item, order) => ({ ...item, order }));

export function moveItem(items: ReadonlyArray<TemplateItem>, order: number, direction: -1 | 1): TemplateItem[] {
  const sorted = renumber([...items]);
  const target = order + direction;
  if (target < 0 || target >= sorted.length) return sorted;
  [sorted[order], sorted[target]] = [sorted[target]!, sorted[order]!];
  return renumber(sorted.map((item, i) => ({ ...item, order: i })));
}

export function removeItem(items: ReadonlyArray<TemplateItem>, order: number): TemplateItem[] {
  return renumber(items.filter((i) => i.order !== order));
}

/** New exercise at the end: 3 × 10 with the exercise's own rest (timed: 3 × 30 s). */
export function addItem(items: ReadonlyArray<TemplateItem>, exercise: Exercise): TemplateItem[] {
  const timed = exercise.kind === 'timed';
  const reps = timed ? 30 : 10;
  return renumber([
    ...items,
    {
      exerciseId: exercise.id,
      order: items.length,
      baseSets: 3,
      optionalExtraSets: 0,
      repMin: reps,
      repMax: reps,
      restSeconds: exercise.defaultRestSeconds,
      targetRPE: null,
    },
  ]);
}

/** Applies a patch to one item, keeping the values sane (min < max, at least 1 set…). */
export function patchItem(items: ReadonlyArray<TemplateItem>, order: number, patch: Partial<TemplateItem>): TemplateItem[] {
  return renumber(
    items.map((item) => {
      if (item.order !== order) return item;
      const next = { ...item, ...patch, order: item.order };
      next.baseSets = Math.min(8, Math.max(1, Math.round(next.baseSets)));
      next.repMin = Math.max(1, Math.round(next.repMin));
      // Fixed reps: repMax = repMin is allowed (and is the default program).
      next.repMax = Math.max(next.repMin, Math.round(next.repMax));
      next.restSeconds = Math.min(600, Math.max(0, Math.round(next.restSeconds)));
      return next;
    }),
  );
}

async function updateItems(db: AppDatabase, templateId: string, change: (items: TemplateItem[]) => TemplateItem[]): Promise<void> {
  await db.transaction('rw', db.sessionTemplates, async () => {
    const template = await db.sessionTemplates.get(templateId);
    if (!template) throw new Error(`Unknown template ${templateId}`);
    await db.sessionTemplates.update(templateId, { items: change(template.items) });
  });
}

export const updateTemplateItem = (db: AppDatabase, templateId: string, order: number, patch: Partial<TemplateItem>) =>
  updateItems(db, templateId, (items) => patchItem(items, order, patch));

export const moveTemplateItem = (db: AppDatabase, templateId: string, order: number, direction: -1 | 1) =>
  updateItems(db, templateId, (items) => moveItem(items, order, direction));

export const removeTemplateItem = (db: AppDatabase, templateId: string, order: number) =>
  updateItems(db, templateId, (items) => removeItem(items, order));

export async function addTemplateItem(db: AppDatabase, templateId: string, exerciseId: string): Promise<void> {
  const exercise = await db.exercises.get(exerciseId);
  if (!exercise) throw new Error(`Unknown exercise ${exerciseId}`);
  await updateItems(db, templateId, (items) => addItem(items, exercise));
}

/** The load step belongs to the exercise: it applies in every session using it. */
export async function updateExerciseIncrement(db: AppDatabase, exerciseId: string, increment: number): Promise<void> {
  // The engine works in hundredths of kg: keep at most two decimals.
  const step = Math.round(increment * 100) / 100;
  if (!(step > 0)) return;
  await db.exercises.update(exerciseId, { increment: step });
}

// ─── Custom exercises ───────────────────────────────────────────────────────────

/** What she can set when creating or editing an exercise. */
export interface ExerciseDraft {
  name: string;
  primaryMuscle: Muscle;
  secondaryMuscle: Muscle | null;
  kind: ExerciseKind;
  isUnilateral: boolean;
  isCompound: boolean;
  defaultRestSeconds: number;
}

/** Spanish error message, or null when the draft is valid. */
export function validateExerciseDraft(draft: ExerciseDraft, existingNames: ReadonlyArray<string>): string | null {
  const name = draft.name.trim();
  if (name.length < 2) return 'Escribe un nombre para el ejercicio.';
  if (name.length > 60) return 'El nombre es demasiado largo (máx. 60 caracteres).';
  if (existingNames.some((n) => n.trim().toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) {
    return 'Ya existe un ejercicio con ese nombre.';
  }
  if (draft.secondaryMuscle === draft.primaryMuscle) return 'El músculo secundario debe ser distinto del principal.';
  return null;
}

/** New exercise with sensible defaults (load step 2,5 kg, or 5 s for timed ones). */
export async function createExercise(db: AppDatabase, draft: ExerciseDraft): Promise<string> {
  const id = newId();
  await db.exercises.add({
    id,
    name: draft.name.trim(),
    primaryMuscle: draft.primaryMuscle,
    secondaryMuscle: draft.secondaryMuscle,
    kind: draft.kind,
    isUnilateral: draft.isUnilateral,
    isCompound: draft.kind === 'timed' ? false : draft.isCompound,
    increment: draft.kind === 'timed' ? 5 : 2.5,
    defaultRestSeconds: Math.min(600, Math.max(0, Math.round(draft.defaultRestSeconds))),
    cues: [],
    machineSettings: '',
    alternativeIds: [],
    notes: '',
  });
  return id;
}

/**
 * Edits an exercise. Its type (load / bodyweight / time) cannot change afterwards: the
 * history would no longer mean the same thing.
 */
export async function updateExercise(db: AppDatabase, exerciseId: string, draft: Omit<ExerciseDraft, 'kind'>): Promise<void> {
  await db.exercises.update(exerciseId, {
    name: draft.name.trim(),
    primaryMuscle: draft.primaryMuscle,
    secondaryMuscle: draft.secondaryMuscle,
    isUnilateral: draft.isUnilateral,
    isCompound: draft.isCompound,
    defaultRestSeconds: Math.min(600, Math.max(0, Math.round(draft.defaultRestSeconds))),
  });
}
