import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../../db/database.ts';
import { SETTINGS_ID, type SetEntry } from '../../db/types.ts';
import {
  abandonWorkout,
  adjustActiveRest,
  completeSet,
  loadWorkoutView,
  removeSet,
  setActiveRest,
  suggestionFor,
  updateSetValues,
  type WorkoutView,
} from '../../db/workouts.ts';
import { startRest } from '../../engine/index.ts';
import { ConfirmSheet } from '../../shared/components/Sheet.tsx';
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
    const reps = set.reps ?? '—';
    const values =
      exercise.kind === 'timed'
        ? `${reps} s`
        : set.weight === null
          ? `${reps} reps`
          : `${formatKg(set.weight)} × ${reps}`;
    return `${exercise.name} · serie ${index + 1}: ${values}`;
  }
  return null;
}
