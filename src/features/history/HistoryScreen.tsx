import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database.ts';
import { listHistory } from '../../db/summary.ts';
import { formatDate, formatDuration, formatTime, formatVolume } from '../../shared/format.ts';
import styles from './history.module.css';

interface HistoryScreenProps {
  onBack: () => void;
  onOpen: (workoutId: string) => void;
}

/** Past sessions, newest first (§6.4). Charts and editing come in later steps. */
export function HistoryScreen({ onBack, onOpen }: HistoryScreenProps) {
  const entries = useLiveQuery(() => listHistory(db), []);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          ‹ Inicio
        </button>
        <h1 className={styles.title}>Historial</h1>
      </header>

      {entries && entries.length === 0 && (
        <p className={styles.empty}>Aún no hay sesiones terminadas. ¡La primera te espera!</p>
      )}

      <ul className={styles.list}>
        {entries?.map((e) => (
          <li key={e.workout.id}>
            <button type="button" className={styles.item} onClick={() => onOpen(e.workout.id)}>
              <span className={styles.code}>{e.templateCode}</span>
              <span className={styles.itemText}>
                <span className={styles.itemTitle}>{e.templateName}</span>
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
    </main>
  );
}
