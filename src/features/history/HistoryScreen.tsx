import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../../db/database.ts';
import { listTrainedExercises, loadWeeklyVolume } from '../../db/progress.ts';
import { listHistory } from '../../db/summary.ts';
import { MUSCLES, MUSCLE_LABELS, SETTINGS_ID, type Muscle } from '../../db/types.ts';
import { volumeStatus } from '../../engine/index.ts';
import { Chart } from '../../shared/components/Chart.tsx';
import { formatDate, formatDuration, formatNumber, formatTime, formatVolume } from '../../shared/format.ts';
import styles from './history.module.css';

export type HistoryTab = 'sessions' | 'exercises' | 'volume';

interface HistoryScreenProps {
  tab: HistoryTab;
  onTab: (tab: HistoryTab) => void;
  onBack: () => void;
  onOpen: (workoutId: string) => void;
  onOpenExercise: (exerciseId: string) => void;
}

const TABS: Array<[HistoryTab, string]> = [
  ['sessions', 'Sesiones'],
  ['exercises', 'Ejercicios'],
  ['volume', 'Volumen'],
];

/** History and progress (§6.4): sessions, per-exercise progress, weekly volume per muscle. */
export function HistoryScreen({ tab, onTab, onBack, onOpen, onOpenExercise }: HistoryScreenProps) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          ‹ Inicio
        </button>
        <h1 className={styles.title}>Historial y progreso</h1>
      </header>

      <div className={styles.tabs} role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={styles.tab} onClick={() => onTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'sessions' && <Sessions onOpen={onOpen} />}
      {tab === 'exercises' && <Exercises onOpen={onOpenExercise} />}
      {tab === 'volume' && <Volume />}
    </main>
  );
}

function Sessions({ onOpen }: { onOpen: (id: string) => void }) {
  const entries = useLiveQuery(() => listHistory(db), []);
  if (entries && entries.length === 0) {
    return <p className={styles.empty}>Aún no hay sesiones terminadas. ¡La primera te espera!</p>;
  }
  return (
    <ul className={styles.list}>
      {entries?.map((e) => (
        <li key={e.workout.id}>
          <button type="button" className={styles.item} onClick={() => onOpen(e.workout.id)}>
            <span className={styles.code}>{e.templateCode}</span>
            <span className={styles.itemText}>
              <span className={styles.itemTitle}>
                {e.templateName}
                {e.workout.isDeload && <span className={styles.tag}>descarga</span>}
              </span>
              <span className={styles.meta}>
                {formatDate(e.workout.startedAt)} · {formatTime(e.workout.startedAt)}
              </span>
              <span className={styles.meta}>
                {formatDuration(e.durationMs)} · {e.setCount} series · {formatVolume(e.volumeKg)}
              </span>
            </span>
            <span className={styles.chevron} aria-hidden>
              ›
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Exercises({ onOpen }: { onOpen: (id: string) => void }) {
  const rows = useLiveQuery(() => listTrainedExercises(db), []);
  if (rows && rows.length === 0) return <p className={styles.empty}>Aquí aparecerá cada ejercicio después de entrenarlo.</p>;
  return (
    <ul className={styles.list}>
      {rows?.map((r) => (
        <li key={r.exercise.id}>
          <button type="button" className={styles.item} onClick={() => onOpen(r.exercise.id)}>
            <span className={styles.itemText}>
              <span className={styles.itemTitle}>{r.exercise.name}</span>
              <span className={styles.meta}>
                {r.sessions} {r.sessions === 1 ? 'sesión' : 'sesiones'} · última: {formatDate(r.lastAt)}
              </span>
            </span>
            <span className={styles.chevron} aria-hidden>
              ›
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const weekLabel = (ms: number) => new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

function Volume() {
  const [muscle, setMuscle] = useState<Muscle>('glutes');
  const data = useLiveQuery(
    async () => ({ weeks: await loadWeeklyVolume(db, Date.now(), 8), settings: await db.settings.get(SETTINGS_ID) }),
    [],
  );
  if (!data) return null;
  const { weeks, settings } = data;
  const target = settings?.weeklySetTargets[muscle] ?? { min: 8, max: 10 };
  const values = weeks.map((w) => w.setsByMuscle[muscle]);
  const targetText = target.min === target.max ? `${target.min}` : `${target.min}-${target.max}`;
  const current = weeks.at(-1);

  return (
    <>
      <p className={styles.meta}>Series por semana (lunes a domingo). Un ejercicio secundario cuenta media serie.</p>
      <div className={styles.chips} role="radiogroup" aria-label="Grupo muscular">
        {MUSCLES.map((m) => {
          const sets = current?.setsByMuscle[m] ?? 0;
          const status = volumeStatus(sets, settings?.weeklySetTargets[m] ?? { min: 8, max: 10 });
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={m === muscle}
              className={`${styles.muscleChip} ${m === muscle ? styles.muscleChipOn : ''}`}
              onClick={() => setMuscle(m)}
            >
              {MUSCLE_LABELS[m]}
              <span className={`${styles.chipCount} ${styles[status]}`}>{formatNumber(sets)}</span>
            </button>
          );
        })}
      </div>

      <section className={styles.card} aria-label={`Volumen semanal de ${MUSCLE_LABELS[muscle]}`}>
        <h2 className={styles.cardTitle}>{MUSCLE_LABELS[muscle]} · últimas 8 semanas</h2>
        <Chart
          kind="bars"
          xLabels={weeks.map((w) => weekLabel(w.weekStart))}
          y={values}
          formatY={(v) => `${formatNumber(v)} series`}
          band={{ min: target.min, max: target.max, label: `Objetivo: ${targetText}` }}
          ariaLabel={`Series semanales de ${MUSCLE_LABELS[muscle]}, objetivo ${targetText}`}
        />
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Semana del</th>
              <th scope="col">Series</th>
            </tr>
          </thead>
          <tbody>
            {[...weeks].reverse().map((w) => (
              <tr key={w.weekStart}>
                <td>{weekLabel(w.weekStart)}</td>
                <td>
                  {formatNumber(w.setsByMuscle[muscle])} / {targetText}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
