import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type ChangeEvent } from 'react';
import { backupFileName, createBackup, markExported, parseBackup, restoreBackup, type BackupFile, type BackupPreview } from '../../db/backup.ts';
import { db } from '../../db/database.ts';
import { SETTINGS_ID } from '../../db/types.ts';
import { ConfirmSheet } from '../../shared/components/Sheet.tsx';
import ui from '../../shared/components/components.module.css';
import { formatDate, formatLongDate } from '../../shared/format.ts';
import { makeJsonFile, shareOrDownload } from '../../shared/share.ts';
import { WeeklyTargets } from './WeeklyTargets.tsx';
import styles from './settings.module.css';

interface SettingsScreenProps {
  onBack: () => void;
  onOpenProgram: (templateId: string) => void;
}

type ExportState =
  | { kind: 'idle' }
  | { kind: 'working' }
  /** The share sheet needs a fresh tap: the file is ready, one more tap opens it. */
  | { kind: 'ready'; file: File; exportedAt: number }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

type ImportState =
  | { kind: 'idle' }
  | { kind: 'confirm'; backup: BackupFile; preview: BackupPreview; currentSessions: number }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string };

const sessions = (n: number) => `${n} ${n === 1 ? 'sesión' : 'sesiones'}`;

export function SettingsScreen({ onBack, onOpenProgram }: SettingsScreenProps) {
  const settings = useLiveQuery(() => db.settings.get(SETTINGS_ID), []);
  const templates = useLiveQuery(() => db.sessionTemplates.orderBy('order').toArray(), []);
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' });
  const fileInput = useRef<HTMLInputElement>(null);

  const deliver = async (file: File, exportedAt: number) => {
    const outcome = await shareOrDownload(file);
    if (outcome === 'needs-tap') {
      setExportState({ kind: 'ready', file, exportedAt });
    } else if (outcome === 'cancelled') {
      setExportState({ kind: 'idle' });
    } else {
      await markExported(db, exportedAt);
      setExportState({
        kind: 'done',
        message: outcome === 'shared' ? 'Copia lista. Guárdala en Archivos o en iCloud Drive.' : 'Copia descargada.',
      });
    }
  };

  const startExport = async () => {
    setExportState({ kind: 'working' });
    try {
      const now = Date.now();
      const backup = await createBackup(db, now, __APP_VERSION__);
      await deliver(makeJsonFile(backupFileName(now), JSON.stringify(backup)), now);
    } catch (error) {
      setExportState({ kind: 'error', message: `No se pudo crear la copia: ${String(error)}` });
    }
  };

  const onFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (!file) return;
    const result = parseBackup(await file.text());
    if (!result.ok) {
      setImportState({ kind: 'error', message: result.error });
      return;
    }
    const currentSessions = await db.workouts.where('status').equals('done').count();
    setImportState({ kind: 'confirm', backup: result.backup, preview: result.preview, currentSessions });
  };

  const confirmImport = async () => {
    if (importState.kind !== 'confirm') return;
    const { backup, preview } = importState;
    try {
      await restoreBackup(db, backup);
      setImportState({ kind: 'done', message: `Datos restaurados: ${sessions(preview.sessions)}.` });
    } catch (error) {
      setImportState({ kind: 'error', message: `No se pudo restaurar: ${String(error)}` });
    }
  };

  const lastExport = settings?.lastExportAt ?? null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          ‹ Inicio
        </button>
        <h1 className={styles.title}>Ajustes</h1>
      </header>

      <section className={styles.section} aria-labelledby="program-title">
        <h2 id="program-title">Programa</h2>
        <p className={styles.text}>Series, repeticiones, descansos, incrementos y ejercicios de cada sesión.</p>
        {templates?.map((t) => (
          <button key={t.id} type="button" className={styles.templateRow} onClick={() => onOpenProgram(t.id)}>
            <strong>{t.code}</strong>
            {t.name}
            <span>{t.items.length} ejercicios ›</span>
          </button>
        ))}
        <div className={styles.row}>
          <span className={styles.rowLabel}>RPE objetivo (reps en reserva = 10 − RPE)</span>
          <div className={styles.choiceRow} role="radiogroup" aria-label="RPE objetivo">
            {[7, 7.5, 8, 8.5, 9].map((rpe) => (
              <button
                key={rpe}
                type="button"
                role="radio"
                aria-checked={(settings?.targetRPE ?? 8) === rpe}
                className={`${styles.choice} ${(settings?.targetRPE ?? 8) === rpe ? styles.choiceOn : ''}`}
                onClick={() => void db.settings.update(SETTINGS_ID, { targetRPE: rpe })}
              >
                {String(rpe).replace('.', ',')}
              </button>
            ))}
          </div>
        </div>
      </section>

      <WeeklyTargets settings={settings} />

      <section className={styles.section} aria-labelledby="workout-title">
        <h2 id="workout-title">Entreno</h2>
        <Toggle
          label="Sonido al terminar el descanso"
          checked={settings?.soundEnabled ?? true}
          onChange={(soundEnabled) => void db.settings.update(SETTINGS_ID, { soundEnabled })}
        />
        <Toggle
          label="Pitido 10 s antes del final"
          checked={settings?.tenSecondBeep ?? true}
          disabled={settings?.soundEnabled === false}
          onChange={(tenSecondBeep) => void db.settings.update(SETTINGS_ID, { tenSecondBeep })}
        />
        <Toggle
          label="Calentamiento antes del primer ejercicio compuesto"
          checked={settings?.warmupEnabled ?? true}
          onChange={(warmupEnabled) => void db.settings.update(SETTINGS_ID, { warmupEnabled })}
        />
      </section>

      <section className={styles.section} aria-labelledby="backup-title">
        <h2 id="backup-title">Copia de seguridad</h2>
        <p className={styles.text}>
          Tus datos solo están en este teléfono. Guarda una copia de vez en cuando (en Archivos, iCloud Drive o
          envíatela por WhatsApp o correo).
        </p>
        <p className={styles.meta}>Última copia: {lastExport ? formatDate(lastExport) : 'nunca'}</p>

        {exportState.kind === 'ready' ? (
          <button type="button" className={ui.primaryButton} onClick={() => void deliver(exportState.file, exportState.exportedAt)}>
            Guardar / compartir la copia
          </button>
        ) : (
          <button type="button" className={ui.primaryButton} disabled={exportState.kind === 'working'} onClick={() => void startExport()}>
            {exportState.kind === 'working' ? 'Preparando…' : 'Exportar copia'}
          </button>
        )}
        {exportState.kind === 'done' && <p className={styles.ok}>{exportState.message}</p>}
        {exportState.kind === 'error' && <p className={styles.error}>{exportState.message}</p>}

        <button type="button" className={ui.secondaryButton} onClick={() => fileInput.current?.click()}>
          Importar copia…
        </button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => void onFilePicked(e)} />
        {importState.kind === 'done' && <p className={styles.ok}>{importState.message}</p>}
        {importState.kind === 'error' && <p className={styles.error}>{importState.message}</p>}
      </section>

      <section className={styles.section} aria-labelledby="about-title">
        <h2 id="about-title">Acerca de</h2>
        <p className={styles.meta}>Bubilandia fuerza · versión {__APP_VERSION__}</p>
      </section>

      <ConfirmSheet
        open={importState.kind === 'confirm'}
        title="¿Restaurar esta copia?"
        message={
          importState.kind === 'confirm'
            ? `La copia contiene ${sessions(importState.preview.sessions)}` +
              (importState.preview.since ? `, desde el ${formatLongDate(importState.preview.since)}` : '') +
              ` (hecha el ${formatLongDate(importState.preview.exportedAt)}). ` +
              `Se reemplazarán todos los datos actuales (${sessions(importState.currentSessions)}).`
            : undefined
        }
        confirmLabel="Reemplazar mis datos"
        danger
        onConfirm={() => void confirmImport()}
        onCancel={() => setImportState({ kind: 'idle' })}
      />
    </main>
  );
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={`${styles.toggle} ${disabled ? styles.toggleDisabled : ''}`}>
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
