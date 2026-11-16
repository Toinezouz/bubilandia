import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database.ts';
import { loadExerciseProgress } from '../../db/progress.ts';
import { STAGNATION_ADVICE } from '../../engine/index.ts';
import { Chart } from '../../shared/components/Chart.tsx';
import { formatDate, formatKg, formatNumber, formatPerformance, formatVolume } from '../../shared/format.ts';
import styles from './history.module.css';

interface ExerciseProgressScreenProps {
  exerciseId: string;
  onBack: () => void;
}

const shortDate = (ms: number) => new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

/** Progress sheet of one exercise (§6.4): e1RM curve, volume, records, full history. */
export function ExerciseProgressScreen({ exerciseId, onBack }: ExerciseProgressScreenProps) {
  const exercise = useLiveQuery(() => db.exercises.get(exerciseId), [exerciseId]);
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          ‹ Progreso
        </button>
        <h1 className={styles.title}>{exercise?.name ?? ''}</h1>
      </header>
      <ExerciseProgressContent exerciseId={exerciseId} />
    </main>
  );
}

/**
 * The progress content itself, without page chrome: also shown inside the exercise sheet
 * during a workout, so she can look at her curve without leaving the session (the rest
 * timer keeps running underneath).
 */
export function ExerciseProgressContent({ exerciseId }: { exerciseId: string }) {
  const p = useLiveQuery(() => loadExerciseProgress(db, exerciseId), [exerciseId]);
  if (p === undefined) return <p className={styles.meta}>Cargando…</p>;
  if (p === null) return null;

  const { exercise, sessions } = p;
  const labels = sessions.map((s) => shortDate(s.at));
  const weighted = exercise.kind === 'weighted';
  // Timed: best hold per session; bodyweight: best reps per session.
  const mainSeries = weighted
    ? sessions.map((s) => (s.e1rm === null ? null : Math.round(s.e1rm * 10) / 10))
    : sessions.map((s) => Math.max(...s.sets.map((x) => x.reps)));
  const mainTitle = weighted ? '1RM estimado por sesión' : exercise.kind === 'timed' ? 'Mejor tiempo por sesión' : 'Mejores repeticiones por sesión';
  const formatMain = weighted ? (v: number) => formatKg(Math.round(v * 10) / 10) : exercise.kind === 'timed' ? (v: number) => `${v} s` : (v: number) => `${v} reps`;

  return (
    <>
      <p className={styles.meta}>
        {sessions.length} {sessions.length === 1 ? 'sesión' : 'sesiones'}
        {sessions.length > 0 && ` · desde el ${formatDate(sessions[0]!.at)}`}
      </p>

      {p.stagnating && (
        <p className={styles.advice} role="status">
          <strong>Estancado.</strong> {STAGNATION_ADVICE}
        </p>
      )}

      {sessions.length === 0 && <p className={styles.empty}>Todavía no hay series terminadas de este ejercicio.</p>}

      {sessions.length >= 2 && (
        <section className={styles.card} aria-label={mainTitle}>
          <h2 className={styles.cardTitle}>{mainTitle}</h2>
          <Chart kind="line" xLabels={labels} y={mainSeries} formatY={formatMain} ariaLabel={`${mainTitle} de ${exercise.name}`} />
        </section>
      )}
      {sessions.length === 1 && <p className={styles.empty}>La curva aparece a partir de la 2.ª sesión.</p>}

      {weighted && sessions.length >= 2 && (
        <section className={styles.card} aria-label="Volumen por sesión">
          <h2 className={styles.cardTitle}>Volumen por sesión</h2>
          <Chart
            kind="bars"
            xLabels={labels}
            y={sessions.map((s) => Math.round(s.volumeKg))}
            formatY={(v) => formatVolume(v)}
            ariaLabel={`Volumen por sesión de ${exercise.name}`}
          />
        </section>
      )}

      {weighted && p.bestE1RM && (
        <section className={styles.card} aria-labelledby="records-title">
          <h2 id="records-title" className={styles.cardTitle}>
            Récords
          </h2>
          <p className={styles.recordMain}>
            Mejor 1RM estimado: <strong>{formatKg(Math.round(p.bestE1RM.value * 10) / 10)}</strong>
            <span className={styles.meta}>
              {' '}
              ({formatNumber(p.bestE1RM.weight)} kg × {p.bestE1RM.reps}, {formatDate(p.bestE1RM.at)})
            </span>
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Reps (o más)</th>
                <th scope="col">Mejor peso</th>
                <th scope="col">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {p.bestByReps.map((r) => (
                <tr key={r.reps}>
                  <td>{r.reps}</td>
                  <td>{formatKg(r.weight)}</td>
                  <td>{formatDate(r.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {sessions.length > 0 && (
        <section className={styles.card} aria-labelledby="all-sets">
          <h2 id="all-sets" className={styles.cardTitle}>
            Todas las series
          </h2>
          <ul className={styles.sessionList}>
            {[...sessions].reverse().map((s) => (
              <li key={s.workoutId}>
                <span className={styles.meta}>
                  {formatDate(s.at)}
                  {s.isDeload && ' · descarga'}
                  {s.isLight && ' · ligera'}
                </span>
                <span>{formatPerformance(s.sets, exercise.kind)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
