import { useState } from 'react';
import { db } from '../../db/database.ts';
import { MUSCLES, MUSCLE_LABELS, SETTINGS_ID, type Muscle, type Settings, type WeeklySetTarget } from '../../db/types.ts';
import { normalizeTarget } from '../../engine/index.ts';
import { Sheet } from '../../shared/components/Sheet.tsx';
import { Stepper } from '../../shared/components/Stepper.tsx';
import ui from '../../shared/components/components.module.css';
import styles from './settings.module.css';

const DEFAULT_TARGET: WeeklySetTarget = { min: 8, max: 10 };
const text = (t: WeeklySetTarget) => (t.min === t.max ? `${t.min}` : `${t.min}-${t.max}`);

/** Weekly working sets per muscle group (§6.4), used by the home summary and the volume chart. */
export function WeeklyTargets({ settings }: { settings: Settings | undefined }) {
  const [editing, setEditing] = useState<Muscle | null>(null);
  const targets = settings?.weeklySetTargets;
  const current = editing ? (targets?.[editing] ?? DEFAULT_TARGET) : DEFAULT_TARGET;

  const save = (muscle: Muscle, target: WeeklySetTarget, changed: 'min' | 'max') => {
    if (!targets) return;
    void db.settings.update(SETTINGS_ID, { weeklySetTargets: { ...targets, [muscle]: normalizeTarget(target, changed) } });
  };

  return (
    <section className={styles.section} aria-labelledby="targets-title">
      <h2 id="targets-title">Objetivos semanales</h2>
      <p className={styles.text}>Series por semana y grupo muscular. Toca uno para cambiarlo.</p>
      <div className={styles.targetGrid}>
        {MUSCLES.map((m) => (
          <button key={m} type="button" className={styles.targetRow} onClick={() => setEditing(m)}>
            {MUSCLE_LABELS[m]}
            <strong>{text(targets?.[m] ?? DEFAULT_TARGET)}</strong>
          </button>
        ))}
      </div>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing ? `Objetivo · ${MUSCLE_LABELS[editing]}` : undefined}>
        {editing && (
          <div className={styles.targetEditor}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Mínimo de series por semana</span>
              <Stepper label="mínimo" value={current.min} step={1} min={0} onChange={(v) => v !== null && save(editing, { ...current, min: v }, 'min')} />
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Máximo de series por semana</span>
              <Stepper label="máximo" value={current.max} step={1} min={0} onChange={(v) => v !== null && save(editing, { ...current, max: v }, 'max')} />
            </div>
            <p className={styles.text}>Un ejercicio que trabaja este músculo de forma secundaria cuenta media serie.</p>
            <button type="button" className={ui.primaryButton} onClick={() => setEditing(null)}>
              Listo
            </button>
          </div>
        )}
      </Sheet>
    </section>
  );
}
