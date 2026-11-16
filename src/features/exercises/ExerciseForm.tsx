import { useState } from 'react';
import { validateExerciseDraft, type ExerciseDraft } from '../../db/program.ts';
import { MUSCLES, MUSCLE_LABELS, type Exercise, type ExerciseKind, type Muscle } from '../../db/types.ts';
import { Stepper } from '../../shared/components/Stepper.tsx';
import ui from '../../shared/components/components.module.css';
import styles from './exercises.module.css';

interface ExerciseFormProps {
  /** Exercise being edited; undefined to create a new one. */
  exercise?: Exercise;
  /** Names already used (the edited exercise excluded), to avoid duplicates. */
  existingNames: string[];
  onSave: (draft: ExerciseDraft) => void;
  onCancel: () => void;
}

const KINDS: Array<[ExerciseKind, string]> = [
  ['weighted', 'Con peso'],
  ['bodyweight', 'Peso corporal'],
  ['timed', 'Por tiempo'],
];

/** Create or edit an exercise: name, muscles, type, unilateral / compound, default rest. */
export function ExerciseForm({ exercise, existingNames, onSave, onCancel }: ExerciseFormProps) {
  const [draft, setDraft] = useState<ExerciseDraft>({
    name: exercise?.name ?? '',
    primaryMuscle: exercise?.primaryMuscle ?? 'glutes',
    secondaryMuscle: exercise?.secondaryMuscle ?? null,
    kind: exercise?.kind ?? 'weighted',
    isUnilateral: exercise?.isUnilateral ?? false,
    isCompound: exercise?.isCompound ?? false,
    defaultRestSeconds: exercise?.defaultRestSeconds ?? 90,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ExerciseDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = () => {
    const problem = validateExerciseDraft(draft, existingNames);
    setError(problem);
    if (!problem) onSave(draft);
  };

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className={styles.field}>
        <span>Nombre</span>
        <input
          className={styles.input}
          type="text"
          value={draft.name}
          maxLength={60}
          autoCapitalize="sentences"
          enterKeyHint="done"
          placeholder="p. ej. Sentadilla con barra"
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>

      <label className={styles.field}>
        <span>Músculo principal</span>
        <select className={styles.input} value={draft.primaryMuscle} onChange={(e) => set({ primaryMuscle: e.target.value as Muscle })}>
          {MUSCLES.map((m) => (
            <option key={m} value={m}>
              {MUSCLE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span>Músculo secundario (cuenta media serie)</span>
        <select
          className={styles.input}
          value={draft.secondaryMuscle ?? ''}
          onChange={(e) => set({ secondaryMuscle: e.target.value === '' ? null : (e.target.value as Muscle) })}
        >
          <option value="">Ninguno</option>
          {MUSCLES.filter((m) => m !== draft.primaryMuscle).map((m) => (
            <option key={m} value={m}>
              {MUSCLE_LABELS[m]}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.field}>
        <span>Tipo</span>
        <div className={styles.segmented} role="radiogroup" aria-label="Tipo de ejercicio">
          {KINDS.map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={draft.kind === kind}
              disabled={!!exercise}
              className={`${styles.segment} ${draft.kind === kind ? styles.segmentOn : ''}`}
              onClick={() => set({ kind })}
            >
              {label}
            </button>
          ))}
        </div>
        {exercise && <span className={styles.muted}>El tipo no se puede cambiar después de crear el ejercicio.</span>}
      </div>

      <label className={styles.switchRow}>
        <span>Unilateral (reps por lado)</span>
        <input type="checkbox" role="switch" checked={draft.isUnilateral} onChange={(e) => set({ isUnilateral: e.target.checked })} />
      </label>
      {draft.kind !== 'timed' && (
        <label className={styles.switchRow}>
          <span>Compuesto (varias articulaciones: lleva calentamiento)</span>
          <input type="checkbox" role="switch" checked={draft.isCompound} onChange={(e) => set({ isCompound: e.target.checked })} />
        </label>
      )}

      <div className={styles.field}>
        <span>Descanso habitual (s)</span>
        <Stepper label="descanso" value={draft.defaultRestSeconds} step={15} min={0} onChange={(v) => v !== null && set({ defaultRestSeconds: v })} />
      </div>

      {!exercise && (
        <p className={styles.muted}>
          El incremento empieza en {draft.kind === 'timed' ? '5 s' : '2,5 kg'}; puedes cambiarlo después en el programa.
        </p>
      )}
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}

      <div className={ui.sheetActions}>
        <button type="submit" className={ui.primaryButton}>
          {exercise ? 'Guardar cambios' : 'Crear ejercicio'}
        </button>
        <button type="button" className={ui.secondaryButton} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
