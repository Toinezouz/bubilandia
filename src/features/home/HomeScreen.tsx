import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database.ts';
import { loadHomeData, type HomeData } from '../../db/home.ts';
import { MUSCLES, MUSCLE_LABELS, SETTINGS_ID, type SessionTemplate } from '../../db/types.ts';
import { formatDaysAgo, volumeStatus } from '../../engine/index.ts';
import { formatNumber } from '../../shared/format.ts';
import styles from './home.module.css';

interface HomeScreenProps {
  onStart: (template: SessionTemplate, data: HomeData) => void;
  onResume: (workoutId: string) => void;
  onHistory: () => void;
  onSettings: () => void;
}

export function HomeScreen({ onStart, onResume, onHistory, onSettings }: HomeScreenProps) {
  const data = useLiveQuery(() => loadHomeData(db, Date.now()), []);
  if (!data) return <main className={styles.page} aria-busy="true" />;

  const now = Date.now();
  const next = data.templates.find((t) => t.id === data.nextTemplateId);
  const others = data.templates.filter((t) => t.id !== data.nextTemplateId);
  const activeTemplate = data.templates.find((t) => t.id === data.activeWorkout?.templateId);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <p className={styles.brand}>Bubilandia fuerza</p>
          <span className={styles.headerLinks}>
            <button type="button" className={styles.headerLink} onClick={onHistory}>
              Historial
            </button>
            <button type="button" className={styles.headerLink} onClick={onSettings}>
              Ajustes
            </button>
          </span>
        </div>
        <h1 className={styles.title}>¿Qué toca hoy?</h1>
      </header>

      {data.activeWorkout && (
        <button type="button" className={styles.resume} onClick={() => onResume(data.activeWorkout!.id)}>
          <span>
            <strong>Continuar entrenamiento</strong>
            <span className={styles.resumeSub}>{activeTemplate?.name ?? 'Sesión en curso'}</span>
          </span>
          <span aria-hidden>›</span>
        </button>
      )}

      {data.backupReminder && (
        <div className={styles.backup} role="status">
          <button type="button" className={styles.backupMain} onClick={onSettings}>
            <strong>Haz una copia de seguridad</strong>
            <span className={styles.resumeSub}>
              {data.settings?.lastExportAt ? `La última fue ${formatDaysAgo(data.settings.lastExportAt, now)}` : 'Aún no has guardado ninguna'}
            </span>
          </button>
          <button
            type="button"
            className={styles.backupClose}
            aria-label="Cerrar aviso"
            onClick={() => void db.settings.update(SETTINGS_ID, { backupReminderDismissedAt: Date.now() })}
          >
            ✕
          </button>
        </div>
      )}

      {next && (
        <button type="button" className={styles.nextCard} onClick={() => onStart(next, data)}>
          <span className={styles.nextLabel}>Siguiente</span>
          <span className={styles.nextName}>
            <span className={styles.code}>{next.code}</span> {next.name}
          </span>
          <span className={styles.meta}>
            {next.items.length} ejercicios · {formatDaysAgo(data.lastDoneAt[next.id] ?? null, now)}
          </span>
          <span className={styles.startCta}>Empezar sesión</span>
        </button>
      )}

      <ul className={styles.others}>
        {others.map((t) => (
          <li key={t.id}>
            <button type="button" className={styles.otherCard} onClick={() => onStart(t, data)}>
              <span className={styles.code}>{t.code}</span>
              <span className={styles.otherText}>
                <span className={styles.otherName}>{t.name}</span>
                <span className={styles.meta}>{formatDaysAgo(data.lastDoneAt[t.id] ?? null, now)}</span>
              </span>
              <span aria-hidden className={styles.chevron}>
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>

      <section className={styles.summary} aria-labelledby="week-title">
        <h2 id="week-title" className={styles.summaryTitle}>
          Últimos 7 días · {data.last7Days.sessions} {data.last7Days.sessions === 1 ? 'sesión' : 'sesiones'}
        </h2>
        <ul className={styles.volume}>
          {MUSCLES.map((m) => {
            const sets = data.last7Days.setsByMuscle[m] ?? 0;
            const target = data.settings?.weeklySetTargets[m] ?? { min: 8, max: 10 };
            const status = volumeStatus(sets, target);
            const pct = Math.min(100, (sets / target.max) * 100);
            return (
              <li key={m} className={styles.volumeRow}>
                <span className={styles.volumeName}>{MUSCLE_LABELS[m]}</span>
                <span className={styles.bar}>
                  <span className={`${styles.barFill} ${styles[status]}`} style={{ width: `${pct}%` }} />
                </span>
                <span className={styles.volumeCount}>
                  {formatNumber(sets)}/{target.min === target.max ? target.min : `${target.min}-${target.max}`}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
