import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../../db/database.ts';
import { READINESS_LABELS, SETTINGS_ID, type Readiness, type SetEntry } from '../../db/types.ts';
import {
  abandonWorkout,
  answerLightSession,
  adjustActiveRest,
  completeSet,
  loadWorkoutView,
  removeSet,
  setActiveRest,
  setReadiness,
  suggestionFor,
  updateSetValues,
  type WorkoutView,
} from '../../db/workouts.ts';
import {
  READINESS_EXERCISES,
  readinessLevel,
  readinessScore,
  shouldOfferLightSession,
  startRest,
} from '../../engine/index.ts';
import { ConfirmSheet, Sheet } from '../../shared/components/Sheet.tsx';
import ui from '../../shared/components/components.module.css';
import { formatKg } from '../../shared/format.ts';
import { unlockAudio } from '../../shared/sound.ts';
import { useWakeLock } from '../../shared/useWakeLock.ts';
import { RestTimerBar } from '../rest-timer/RestTimerBar.tsx';
import { ExerciseCard } from './ExerciseCard.tsx';
import { RpeSheet } from './RpeSheet.tsx';
import styles from './workout.module.css';

interface WorkoutScreenProps {
  workoutId: string;
  onExit: () => void;
  /** "Terminar sesión": opens the summary, where the workout is actually finished. */
  onFinish: () => void;
}

type Pending =
  | { kind: 'rpe'; set: SetEntry; editing: boolean }
  | { kind: 'remove'; set: SetEntry }
  | { kind: 'abandon' }
  | null;

export function WorkoutScreen({ workoutId, onExit, onFinish }: WorkoutScreenProps) {
  const view = useLiveQuery(() => loadWorkoutView(db, workoutId), [workoutId]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const settings = useLiveQuery(() => db.settings.get(SETTINGS_ID), []);
  const wakeLock = useWakeLock(true);

  // Form of the day (§7.5): measured on the first exercises, saved with the workout.
  const form = view ? measureForm(view, settings?.targetRPE ?? 8) : null;
  useEffect(() => {
    if (!view || !form || form.exercisesMeasured === 0) return;
    if (form.readiness !== view.workout.readiness) void setReadiness(db, view.workout.id, form.readiness);
  }, [view, form?.readiness, form?.exercisesMeasured]);

  // History-based suggestion + last performance per exercise. Depends only on which
  // exercises are in the workout, not on the sets being typed.
  const exerciseKey = view?.exercises.map((e) => `${e.performed.id}:${e.exercise.id}`).join('|') ?? '';
  const guidance = useLiveQuery(async () => {
    if (!view) return undefined;
    const settings = await db.settings.get(SETTINGS_ID);
    const targetRPE = settings?.targetRPE ?? 8;
    const entries = await Promise.all(
      view.exercises.map(async ({ performed, exercise, item }) => {
        const result = await suggestionFor(
          db,
          exercise,
          item ?? { repMin: 8, repMax: 12, targetRPE: null },
          targetRPE,
          workoutId,
        );
        return [performed.id, result] as const;
      }),
    );
    return new Map(entries);
  }, [exerciseKey]);

  if (view === undefined) return <main className={styles.page} aria-busy="true" />;
  if (view === null || view.workout.status !== 'in_progress') {
    return (
      <main className={styles.page}>
        <p>Esta sesión ya no está en curso.</p>
        <button type="button" className={styles.secondaryWide} onClick={onExit}>
          Volver al inicio
        </button>
      </main>
    );
  }

  // Auto-expand the first exercise with work left, unless she opened another one.
  const autoId =
    view.exercises.find((e) => !e.performed.skipped && e.sets.some((s) => s.completedAt === null))?.performed.id ?? null;
  const openId = expandedId ?? autoId;
  const pendingSets = view.exercises.reduce(
    (n, e) => n + (e.performed.skipped ? 0 : e.sets.filter((s) => s.completedAt === null).length),
    0,
  );

  const pickRpe = async (rpe: number) => {
    if (pending?.kind !== 'rpe') return;
    const { set, editing } = pending;
    setPending(null);
    if (editing) {
      await updateSetValues(db, set.id, { rpe });
      return;
    }
    const now = Date.now();
    await completeSet(db, set.id, rpe, now);
    // Exercise finished → hand the screen back to auto mode (next exercise opens).
    const ex = view.exercises.find((e) => e.sets.some((s) => s.id === set.id));
    const stillPending = ex?.sets.some((s) => s.completedAt === null && s.id !== set.id);
    if (!stillPending) setExpandedId(null);
    // Rest starts right after the RPE, with this exercise's rest (unilateral: one set row
    // already covers both sides, so there is no rest between sides).
    if (ex && pendingSets > 1) {
      const seconds = ex.item?.restSeconds ?? ex.exercise.defaultRestSeconds;
      await setActiveRest(db, workoutId, startRest(seconds, now));
    } else {
      await setActiveRest(db, workoutId, null);
    }
  };

  const rest = view.workout.activeRest;

  return (
    <main
      className={`${styles.page} ${rest ? styles.pageWithTimer : ''}`}
      // iOS: audio only plays after a gesture; after a reload any tap re-unlocks it.
      onPointerDownCapture={unlockAudio}
    >
      <header className={styles.topBar}>
        <button type="button" className={styles.backButton} onClick={onExit}>
          ‹ Inicio
        </button>
        <div className={styles.topTitle}>
          <span className={styles.topCode}>{view.template?.code}</span>
          <h1>{view.template?.name ?? 'Sesión'}</h1>
          {(form?.readiness || view.workout.isDeload) && (
            <span className={styles.form}>
              {form?.readiness && `Forma: ${READINESS_LABELS[form.readiness]}`}
              {form?.readiness && (view.workout.isDeload || view.workout.lightSession) && ' · '}
              {view.workout.isDeload ? 'descarga' : view.workout.lightSession ? 'ligera' : ''}
            </span>
          )}
        </div>
      </header>

      {wakeLock === 'unsupported' && (
        <p className={styles.tip}>Pon el bloqueo automático en «Nunca» durante el entreno.</p>
      )}

      <div className={styles.cards}>
        {view.exercises.map(({ performed, exercise, item, sets }) => {
          const g = guidance?.get(performed.id);
          return (
            <ExerciseCard
              key={performed.id}
              performed={performed}
              exercise={exercise}
              item={item}
              sets={sets}
              suggestion={g?.suggestion}
              last={guidance ? (g?.last ?? null) : undefined}
              expanded={performed.id === openId}
              onToggle={() => setExpandedId(performed.id === openId ? '' : performed.id)}
              onDone={(set) => setPending({ kind: 'rpe', set, editing: false })}
              onEditRpe={(set) => setPending({ kind: 'rpe', set, editing: true })}
              onRemoveSet={(set) => setPending({ kind: 'remove', set })}
              readiness={form?.readiness ?? null}
              lightSession={view.workout.lightSession === true || view.workout.isDeload}
            />
          );
        })}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.finishButton} onClick={onFinish}>
          Terminar sesión
        </button>
        <button type="button" className={styles.linkButton} onClick={() => setPending({ kind: 'abandon' })}>
          Abandonar sesión
        </button>
      </footer>

      <RestTimerBar
        rest={rest}
        nextLabel={nextSetLabel(view)}
        soundEnabled={settings?.soundEnabled ?? true}
        warningEnabled={settings?.tenSecondBeep ?? true}
        onAdjust={(delta) => void adjustActiveRest(db, workoutId, delta, Date.now())}
        onSkip={() => void setActiveRest(db, workoutId, null)}
        onDismiss={() => void setActiveRest(db, workoutId, null)}
      />

      <Sheet
        open={
          pending === null &&
          !!form &&
          shouldOfferLightSession({
            exercisesMeasured: form.exercisesMeasured,
            readiness: form.readiness,
            alreadyOffered: view.workout.lightSessionOffered === true || view.workout.isDeload,
          })
        }
        onClose={() => void answerLightSession(db, workoutId, false)}
        title="¿Hacemos una sesión ligera hoy?"
      >
        <p className={ui.sheetText}>Hoy cuesta más de lo previsto. Bajamos un 10 % las cargas que quedan y sin serie extra.</p>
        <div className={ui.sheetActions}>
          <button type="button" className={ui.primaryButton} onClick={() => void answerLightSession(db, workoutId, true)}>
            Sí, sesión ligera
          </button>
          <button type="button" className={ui.secondaryButton} onClick={() => void answerLightSession(db, workoutId, false)}>
            No, seguir normal
          </button>
        </div>
      </Sheet>

      <RpeSheet
        open={pending?.kind === 'rpe'}
        current={pending?.kind === 'rpe' ? pending.set.rpe : null}
        onPick={(rpe) => void pickRpe(rpe)}
        onClose={() => setPending(null)}
      />

      <ConfirmSheet
        open={pending?.kind === 'remove'}
        title="¿Eliminar esta serie?"
        message={pending?.kind === 'remove' && pending.set.completedAt !== null ? 'Ya estaba hecha: se perderán sus datos.' : undefined}
        confirmLabel="Eliminar serie"
        danger
        onConfirm={() => {
          if (pending?.kind === 'remove') void removeSet(db, pending.set.id);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />

      <ConfirmSheet
        open={pending?.kind === 'abandon'}
        title="¿Abandonar la sesión?"
        message="No contará en el historial ni en la progresión."
        confirmLabel="Abandonar"
        danger
        onConfirm={() => {
          setPending(null);
          void abandonWorkout(db, workoutId, Date.now()).then(onExit);
        }}
        onCancel={() => setPending(null)}
      />
    </main>
  );
}

/** "Prensa sentada · serie 2: 50 kg × 10" for the next set to do, or null when all is done. */
function nextSetLabel(view: WorkoutView): string | null {
  for (const { performed, exercise, sets } of view.exercises) {
    if (performed.skipped) continue;
    const index = sets.findIndex((s) => s.completedAt === null);
    if (index === -1) continue;
    const set = sets[index]!;
    if (set.isWarmup) {
      return `${exercise.name} · calentamiento: ${set.weight === null ? '—' : formatKg(set.weight)} × ${set.reps ?? '—'}`;
    }
    const reps = set.reps ?? '—';
    const values =
      exercise.kind === 'timed'
        ? `${reps} s`
        : set.weight === null
          ? `${reps} reps`
          : `${formatKg(set.weight)} × ${reps}`;
    const workingIndex = sets.filter((x) => !x.isWarmup).indexOf(set);
    return `${exercise.name} · serie ${workingIndex + 1}: ${values}`;
  }
  return null;
}

/**
 * Form of the day from the first exercises with completed working sets (timed ones excluded:
 * seconds are not comparable with reps). Target reps = the pre-filled target of each set.
 */
function measureForm(view: WorkoutView, globalTargetRPE: number): { readiness: Readiness | null; exercisesMeasured: number } {
  const measured = view.exercises
    .filter((e) => !e.performed.skipped && e.exercise.kind !== 'timed')
    .filter((e) => e.sets.some((s) => !s.isWarmup && s.completedAt !== null && s.reps !== null))
    .slice(0, READINESS_EXERCISES);
  const samples = measured.flatMap((e) =>
    e.sets
      .filter((s) => !s.isWarmup && s.completedAt !== null && s.reps !== null)
      .map((s) => ({
        reps: s.reps!,
        rpe: s.rpe,
        targetReps: s.suggestedReps ?? e.item?.repMin ?? s.reps!,
        targetRPE: e.item?.targetRPE ?? globalTargetRPE,
      })),
  );
  const score = readinessScore(samples);
  return { readiness: score === null ? null : readinessLevel(score), exercisesMeasured: measured.length };
}
