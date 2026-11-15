import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState, type ChangeEvent } from 'react';
import { backupFileName, createBackup, markExported, parseBackup, restoreBackup, type BackupFile, type BackupPreview } from '../../db/backup.ts';
import { db } from '../../db/database.ts';
import { SETTINGS_ID } from '../../db/types.ts';
import { ConfirmSheet } from '../../shared/components/Sheet.tsx';
import ui from '../../shared/components/components.module.css';
import { formatDate, formatLongDate } from '../../shared/format.ts';
import { makeJsonFile, shareOrDownload } from '../../shared/share.ts';
import styles from './settings.module.css';

interface SettingsScreenProps {
  onBack: () => void;
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

export function SettingsScreen({ onBack }: SettingsScreenProps) {
  const settings = useLiveQuery(() => db.settings.get(SETTINGS_ID), []);
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
