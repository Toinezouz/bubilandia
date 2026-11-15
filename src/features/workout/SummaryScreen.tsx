import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database.ts';
import { loadWorkoutSummary } from '../../db/summary.ts';
import { READINESS_LABELS } from '../../db/types.ts';
import { finishWorkout } from '../../db/workouts.ts';
import { formatDuration, formatKg, formatNumber, formatVolume } from '../../shared/format.ts';
import ui from '../../shared/components/components.module.css';
import styles from './summary.module.css';

interface SummaryScreenProps {
  workoutId: string;
  /** Back to the workout (nothing is finished yet). */
  onBack: () => void;
  onFinished: () => void;
}

/** End-of-workout recap (§6.2): duration, sets, volume, records, form of the day, note. */
export function SummaryScreen({ workoutId, onBack, onFinished }: SummaryScreenProps) {
  const summary = useLiveQuery(() => loadWorkoutSummary(db, workoutId, Date.now()), [workoutId]);
  if (summary === undefined) return <main className={styles.page} aria-busy="true" />;
  if (summary === null) return null;

  const finish = async () => {
    await finishWorkout(db, workoutId, Date.now());
    onFinished();
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          ‹ Volver al entreno
        </button>
        <h1 className={styles.title}>{summary.setCount > 0 ? '¡Buen trabajo!' : 'Resumen'}</h1>
        <p className={styles.subtitle}>
          <span className={styles.code}>{summary.templateCode}</span> {summary.templateName}
        </p>
      </header>

      <dl className={styles.stats}>
        <div>
          <dt>Duración</dt>
          <dd>{formatDuration(summary.durationMs)}</dd>
        </div>
        <div>
          <dt>Series</dt>
          <dd>{summary.setCount}</dd>
        </div>
        <div>
          <dt>Ejercicios</dt>
          <dd>{summary.exerciseCount}</dd>
        </div>
        <div>
          <dt>Volumen</dt>
          <dd>{formatVolume(summary.volumeKg)}</dd>
        </div>
      </dl>

      {summary.readiness && <p className={styles.readiness}>Forma del día: {READINESS_LABELS[summary.readiness]}</p>}

      {summary.records.length > 0 && (
        <section className={styles.records} aria-labelledby="records-title">
          <h2 id="records-title">Récords</h2>
          <ul>
            {summary.records.map((r) => (
              <li key={r.exerciseName}>
                <span className={styles.badge}>Récord</span>
                <span>
                  <strong>{r.exerciseName}</strong>
                  {r.records.map((rec) => (
                    <span key={rec.type} className={styles.recordLine}>
                      {rec.type === 'weight_for_reps'
                        ? `Más peso a ${rec.reps} reps: ${formatKg(rec.weight)}`
                        : `Mejor 1RM estimado: ${formatKg(Number(rec.e1rm.toFixed(1)))} (${formatNumber(rec.weight)} × ${rec.reps})`}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {summary.pendingSets > 0 && (
        <p className={styles.warning}>
          Quedan {summary.pendingSets} {summary.pendingSets === 1 ? 'serie sin hacer: no se guardará' : 'series sin hacer: no se guardarán'}.
        </p>
      )}

      <label className={styles.noteLabel}>
        Nota de la sesión (opcional)
        <textarea
          className={styles.note}
          rows={3}
          placeholder="¿Cómo te has sentido?"
          defaultValue={summary.workout.notes}
          onChange={(e) => void db.workouts.update(workoutId, { notes: e.target.value })}
        />
      </label>

      <div className={styles.actions}>
        <button type="button" className={ui.primaryButton} onClick={() => void finish()}>
          Terminar
        </button>
      </div>
    </main>
  );
}
