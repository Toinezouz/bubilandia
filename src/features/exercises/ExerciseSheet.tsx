import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/database.ts';
import { MUSCLE_LABELS, type Exercise } from '../../db/types.ts';
import { updateExerciseInfo } from '../../db/workouts.ts';
import { Sheet } from '../../shared/components/Sheet.tsx';
import styles from './exercises.module.css';

interface ExerciseSheetProps {
  exercise: Exercise | null;
  /** Show the alternatives first ("Cambiar ejercicio"). */
  swapMode: boolean;
  /** Swapping is only possible before any working set of the slot is done. */
  canSwap: boolean;
  onSwap: (exerciseId: string) => void;
  onClose: () => void;
}

/** Exercise sheet (§4, §6.2): cues, machine settings, alternatives. */
export function ExerciseSheet({ exercise, swapMode, canSwap, onSwap, onClose }: ExerciseSheetProps) {
  const alternatives = useLiveQuery(
    async () => (exercise ? (await db.exercises.bulkGet(exercise.alternativeIds)).filter((e): e is Exercise => !!e) : []),
    [exercise?.id, exercise?.alternativeIds.join(',')],
  );
  if (!exercise) return null;

  const altBlock = (
    <section className={styles.block}>
      <h3>Alternativas (si la máquina está ocupada)</h3>
      {!canSwap && <p className={styles.muted}>Ya hay series hechas de este ejercicio: hoy no se puede cambiar.</p>}
      {alternatives && alternatives.length === 0 && <p className={styles.muted}>Sin alternativas para este ejercicio.</p>}
      <ul className={styles.alts}>
        {alternatives?.map((alt) => (
          <li key={alt.id}>
            <span>{alt.name}</span>
            {canSwap && (
              <button type="button" className={styles.useButton} onClick={() => onSwap(alt.id)}>
                Usar hoy
              </button>
            )}
          </li>
        ))}
      </ul>
      {canSwap && <p className={styles.muted}>Cada alternativa tiene su propio historial y su propia progresión.</p>}
    </section>
  );

  return (
    <Sheet open onClose={onClose} title={swapMode ? `Cambiar ${exercise.name}` : exercise.name}>
      <div className={styles.sheetBody}>
        {swapMode && altBlock}

        <p className={styles.muscles}>
          {MUSCLE_LABELS[exercise.primaryMuscle]}
          {exercise.secondaryMuscle && ` · ${MUSCLE_LABELS[exercise.secondaryMuscle]} (secundario)`}
          {exercise.isUnilateral && ' · unilateral'}
        </p>

        <section className={styles.block}>
          <h3>Técnica</h3>
          <ul className={styles.cues}>
            {exercise.cues.map((cue) => (
              <li key={cue}>{cue}</li>
            ))}
          </ul>
          {exercise.notes && <p className={styles.muted}>{exercise.notes}</p>}
        </section>

        <label className={styles.block}>
          <h3>Ajustes de máquina</h3>
          <textarea
            className={styles.textarea}
            rows={2}
            placeholder="p. ej. asiento 4, respaldo 2"
            defaultValue={exercise.machineSettings}
            onChange={(e) => void updateExerciseInfo(db, exercise.id, { machineSettings: e.target.value })}
          />
        </label>

        {!swapMode && altBlock}
      </div>
    </Sheet>
  );
}
