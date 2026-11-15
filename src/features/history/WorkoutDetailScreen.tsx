import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database.ts';
import { loadWorkoutSummary } from '../../db/summary.ts';
import { loadWorkoutView } from '../../db/workouts.ts';
import { formatDate, formatDuration, formatKg, formatNumber, formatTime, formatVolume } from '../../shared/format.ts';
import { READINESS_LABELS } from '../../db/types.ts';
import styles from './history.module.css';

interface WorkoutDetailScreenProps {
  workoutId: string;
  onBack: () => void;
}

/** One past session, read-only for now (corrections come with the history editing step). */
export function WorkoutDetailScreen({ workoutId, onBack }: WorkoutDetailScreenProps) {
  const data = useLiveQuery(
    async () => ({ view: await loadWorkoutView(db, workoutId), summary: await loadWorkoutSummary(db, workoutId, Date.now()) }),
    [workoutId],
  );
  const view = data?.view;
  const summary = data?.summary;

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
            </p>
          </>
        )}
      </header>

      {view?.workout.readiness && <p>Forma del día: {READINESS_LABELS[view.workout.readiness]}</p>}
      {view?.workout.notes && <p className={styles.notes}>{view.workout.notes}</p>}

      {summary && summary.records.length > 0 && (
        <p className={styles.recordsLine}>
          Récords: {summary.records.map((r) => r.exerciseName).join(', ')}
        </p>
      )}

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
                      <span className={styles.setIndex}>{i + 1}</span>
                      <span>
                        {exercise.kind === 'timed'
                          ? `${s.reps} s`
                          : s.weight === null
                            ? `${s.reps} reps`
                            : `${formatKg(s.weight)} × ${s.reps}`}
                      </span>
                      {s.rpe !== null && <span className={styles.rpe}>RPE {formatNumber(s.rpe)}</span>}
                    </li>
                  ))}
                </ol>
              )}
              {performed.note && <p className={styles.notes}>{performed.note}</p>}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
