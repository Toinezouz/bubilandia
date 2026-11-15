import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../../db/database.ts';
import { loadWorkoutSummary } from '../../db/summary.ts';
import { READINESS_LABELS, type Exercise, type SetEntry } from '../../db/types.ts';
import { deleteWorkout, loadWorkoutView, removeSet, updateSetValues } from '../../db/workouts.ts';
import { RPE_VALUES } from '../../engine/index.ts';
import { ConfirmSheet, Sheet } from '../../shared/components/Sheet.tsx';
import { Stepper } from '../../shared/components/Stepper.tsx';
import ui from '../../shared/components/components.module.css';
import { formatDate, formatDuration, formatKg, formatNumber, formatTime, formatVolume } from '../../shared/format.ts';
import styles from './history.module.css';

interface WorkoutDetailScreenProps {
  workoutId: string;
  onBack: () => void;
}

type Editing = { set: SetEntry; exercise: Exercise } | null;

/**
 * One past session (§6.4). Every value can be corrected: tap a set to fix its load, reps or
 * RPE (saved at once), delete a set, edit the notes, or delete the whole session.
 */
export function WorkoutDetailScreen({ workoutId, onBack }: WorkoutDetailScreenProps) {
  const data = useLiveQuery(
    async () => ({ view: await loadWorkoutView(db, workoutId), summary: await loadWorkoutSummary(db, workoutId, Date.now()) }),
    [workoutId],
  );
  const [editing, setEditing] = useState<Editing>(null);
  const [confirm, setConfirm] = useState<'set' | 'workout' | null>(null);
  const view = data?.view;
  const summary = data?.summary;
  // Keep the sheet in sync with the saved values.
  const liveSet = editing && view?.exercises.flatMap((e) => e.sets).find((s) => s.id === editing.set.id);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          ‹ Historial
        </button>
        {view && (
          <>
            <h1 className={styles.title}>{view.template?.name ?? 'Sesión'}</h1>
            <p className={styles.meta}>
              {formatDate(view.workout.startedAt)} · {formatTime(view.workout.startedAt)}
              {summary && ` · ${formatDuration(summary.durationMs)} · ${formatVolume(summary.volumeKg)}`}
              {view.workout.isDeload && ' · descarga'}
            </p>
          </>
        )}
      </header>

      {view?.workout.readiness && <p>Forma del día: {READINESS_LABELS[view.workout.readiness]}</p>}

      {summary && summary.records.length > 0 && (
        <p className={styles.recordsLine}>Récords: {summary.records.map((r) => r.exerciseName).join(', ')}</p>
      )}

      <p className={styles.meta}>Toca una serie para corregirla.</p>

      <ul className={styles.exercises}>
        {view?.exercises.map(({ performed, exercise, sets }) => {
          const done = sets.filter((s) => s.completedAt !== null && !s.isWarmup);
          return (
            <li key={performed.id} className={styles.exercise}>
              <h2 className={styles.exerciseName}>{exercise.name}</h2>
              {performed.skipped || done.length === 0 ? (
                <p className={styles.meta}>{performed.skipped ? 'Saltado' : 'Sin series'}</p>
              ) : (
                <ol className={styles.sets}>
                  {done.map((s, i) => (
                    <li key={s.id}>
                      <button type="button" className={styles.setButton} onClick={() => setEditing({ set: s, exercise })}>
                        <span className={styles.setIndex}>{i + 1}</span>
                        <span>{describe(s, exercise)}</span>
                        {s.rpe !== null && <span className={styles.rpe}>RPE {formatNumber(s.rpe)}</span>}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {performed.note && <p className={styles.notes}>{performed.note}</p>}
            </li>
          );
        })}
      </ul>

      {view && (
        <label className={styles.noteLabel}>
          Nota de la sesión
          <textarea
            className={styles.noteField}
            rows={3}
            defaultValue={view.workout.notes}
            placeholder="Sin nota"
            onChange={(e) => void db.workouts.update(workoutId, { notes: e.target.value })}
          />
        </label>
      )}

      <button type="button" className={styles.deleteSession} onClick={() => setConfirm('workout')}>
        Eliminar esta sesión
      </button>

      <Sheet open={!!editing && !!liveSet} onClose={() => setEditing(null)} title={editing ? `Corregir · ${editing.exercise.name}` : undefined}>
        {editing && liveSet && (
          <div className={styles.editBody}>
            {editing.exercise.kind !== 'timed' && (
              <Stepper
                label="peso"
                unit="kg"
                decimal
                value={liveSet.weight}
                step={editing.exercise.increment}
                min={editing.exercise.increment}
                allowEmpty={editing.exercise.kind === 'bodyweight'}
                onChange={(weight) => void updateSetValues(db, liveSet.id, { weight })}
              />
            )}
            <Stepper
              label={editing.exercise.kind === 'timed' ? 'segundos' : 'repeticiones'}
              unit={editing.exercise.kind === 'timed' ? 's' : 'reps'}
              value={liveSet.reps}
              step={editing.exercise.kind === 'timed' ? editing.exercise.increment : 1}
              min={1}
              onChange={(reps) => reps !== null && void updateSetValues(db, liveSet.id, { reps })}
            />
            <div className={styles.rpeGrid} role="radiogroup" aria-label="RPE">
              {RPE_VALUES.map((rpe) => (
                <button
                  key={rpe}
                  type="button"
                  role="radio"
                  aria-checked={liveSet.rpe === rpe}
                  className={`${styles.rpeChoice} ${liveSet.rpe === rpe ? styles.rpeChoiceOn : ''}`}
                  onClick={() => void updateSetValues(db, liveSet.id, { rpe })}
                >
                  {formatNumber(rpe)}
                </button>
              ))}
            </div>
            <div className={ui.sheetActions}>
              <button type="button" className={ui.primaryButton} onClick={() => setEditing(null)}>
                Listo
              </button>
              <button type="button" className={ui.secondaryButton} onClick={() => setConfirm('set')}>
                Eliminar serie
              </button>
            </div>
          </div>
        )}
      </Sheet>

      <ConfirmSheet
        open={confirm === 'set'}
        title="¿Eliminar esta serie?"
        message="Se borrará del historial y de los cálculos de progresión."
        confirmLabel="Eliminar serie"
        danger
        onConfirm={() => {
          if (editing) void removeSet(db, editing.set.id);
          setConfirm(null);
          setEditing(null);
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmSheet
        open={confirm === 'workout'}
        title="¿Eliminar esta sesión?"
        message="Se borrarán todas sus series. No se puede deshacer (salvo importando una copia)."
        confirmLabel="Eliminar sesión"
        danger
        onConfirm={() => {
          setConfirm(null);
          void deleteWorkout(db, workoutId).then(onBack);
        }}
        onCancel={() => setConfirm(null)}
      />
    </main>
  );
}

function describe(s: SetEntry, exercise: Exercise): string {
  if (exercise.kind === 'timed') return `${s.reps} s`;
  if (s.weight === null) return `${s.reps} reps`;
  return `${formatKg(s.weight)} × ${s.reps}`;
}
