/** Read model for the home screen (§6.1). */

import { nextTemplateId, setsPerMuscle, shouldRemindBackup, type VolumeEntry } from '../engine/index.ts';
import type { AppDatabase } from './database.ts';
import { SETTINGS_ID, type Muscle, type SessionTemplate, type Settings, type Workout } from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface HomeData {
  templates: SessionTemplate[];
  nextTemplateId: string | null;
  /** Last completed session per template (epoch ms), absent if never done. */
  lastDoneAt: Record<string, number>;
  /** End of the last completed leg session, for the < 48 h warning. */
  lastLegSessionAt: number | null;
  activeWorkout: Workout | null;
  /** Show the "Haz una copia de seguridad" banner. */
  backupReminder: boolean;
  settings: Settings | undefined;
  last7Days: {
    sessions: number;
    setsByMuscle: Partial<Record<Muscle, number>>;
  };
}

const finishedAt = (w: Workout) => w.endedAt ?? w.startedAt;

export async function loadHomeData(db: AppDatabase, now: number): Promise<HomeData> {
  const [templates, settings, done, active] = await Promise.all([
    db.sessionTemplates.orderBy('order').toArray(),
    db.settings.get(SETTINGS_ID),
    db.workouts.where('status').equals('done').sortBy('startedAt'),
    db.workouts.where('status').equals('in_progress').first(),
  ]);

  const lastDoneAt: Record<string, number> = {};
  for (const w of done) lastDoneAt[w.templateId] = Math.max(lastDoneAt[w.templateId] ?? 0, finishedAt(w));

  const legIds = new Set(templates.filter((t) => t.isLegDay).map((t) => t.id));
  const legTimes = done.filter((w) => legIds.has(w.templateId)).map(finishedAt);
  const lastDone = done.at(-1);

  const recent = done.filter((w) => w.startedAt >= now - 7 * DAY_MS);
  const performed = await db.performedExercises
    .where('workoutId')
    .anyOf(recent.map((w) => w.id))
    .filter((p) => !p.skipped)
    .toArray();
  const exercises = new Map((await db.exercises.bulkGet(performed.map((p) => p.exerciseId))).flatMap((e) => (e ? [[e.id, e]] : [])));
  const sets = await db.sets
    .where('performedExerciseId')
    .anyOf(performed.map((p) => p.id))
    .filter((s) => !s.isWarmup && s.completedAt !== null)
    .toArray();
  const setCount = new Map<string, number>();
  for (const s of sets) setCount.set(s.performedExerciseId, (setCount.get(s.performedExerciseId) ?? 0) + 1);

  const entries: VolumeEntry[] = performed.flatMap((p) => {
    const e = exercises.get(p.exerciseId);
    return e ? [{ primaryMuscle: e.primaryMuscle, secondaryMuscle: e.secondaryMuscle, sets: setCount.get(p.id) ?? 0 }] : [];
  });

  return {
    templates,
    nextTemplateId: nextTemplateId(templates, lastDone?.templateId ?? null),
    lastDoneAt,
    lastLegSessionAt: legTimes.length ? Math.max(...legTimes) : null,
    activeWorkout: active ?? null,
    backupReminder: shouldRemindBackup({
      hasCompletedSessions: done.length > 0,
      lastExportAt: settings?.lastExportAt ?? null,
      dismissedAt: settings?.backupReminderDismissedAt ?? null,
      now,
    }),
    settings,
    last7Days: { sessions: recent.length, setsByMuscle: setsPerMuscle(entries) as Partial<Record<Muscle, number>> },
  };
}
