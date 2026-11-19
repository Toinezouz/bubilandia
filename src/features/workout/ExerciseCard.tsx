import { useState } from 'react';
import { db } from '../../db/database.ts';
import type { Exercise, PerformedExercise, Readiness, SetEntry, TemplateItem } from '../../db/types.ts';
import {
  addSet,
  answerFormCheck,
  setExerciseNote,
  setExerciseSkipped,
  swapExercise,
  toggleWarmupDone,
  updateSetValues,
  type LastPerformance,
} from '../../db/workouts.ts';
import { adjustAfterFirstSet, adjustAfterLaterSet, bonusSetAllowed, type Suggestion } from '../../engine/index.ts';
import { formatKg, formatNumber, formatPerformance, formatRepTarget, formatSeconds, formatTarget } from '../../shared/format.ts';
import { Stepper } from '../../shared/components/Stepper.tsx';
import { ExerciseSheet } from '../exercises/ExerciseSheet.tsx';
import styles from './workout.module.css';

interface ExerciseCardProps {
  performed: PerformedExercise;
  exercise: Exercise;
  item: TemplateItem | undefined;
  sets: SetEntry[];
  suggestion: Suggestion | undefined;
  last: LastPerformance | null | undefined;
  expanded: boolean;
  onToggle: () => void;
  /** "Hecho" tapped on a pending set → parent opens the RPE sheet. */
  onDone: (set: SetEntry) => void;
  /** Tap on a completed set's RPE badge → change it. */
  onEditRpe: (set: SetEntry) => void;
  onRemoveSet: (set: SetEntry) => void;
  readiness: Readiness | null;
  lightSession: boolean;
  /** RPE aimed at the end of each set for this exercise. */
  targetRPE: number;
}

export function ExerciseCard(props: ExerciseCardProps) {
  const { performed, exercise, item, suggestion, last, expanded, onToggle } = props;
  const [focusedSetId, setFocusedSetId] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(performed.note !== '');
  const [sheet, setSheet] = useState<'info' | 'swap' | null>(null);

  // Warm-up rows are shown apart and never counted (§6.2).
  const warmups = props.sets.filter((s) => s.isWarmup);
  const sets = props.sets.filter((s) => !s.isWarmup);
  const doneCount = sets.filter((s) => s.completedAt !== null).length;
  const firstPending = sets.find((s) => s.completedAt === null);
  // The focused row shows the full editor; by default it is the next set to do.
  const focusedId = sets.some((s) => s.id === focusedSetId) ? focusedSetId : (firstPending?.id ?? null);
  const finished = sets.length > 0 && doneCount === sets.length;
  const canSwap = doneCount === 0;

  // §7.5 — like a coach watching each set. After the 1st working set: "Hoy vas fuerte" /
  // "Día duro" (both directions). After a later set: fatigue check (lighter only). Each
  // question is asked once, for the last set done.
  const first = sets[0];
  const doneSets = sets.filter((s) => s.completedAt !== null && s.reps !== null);
  const lastDoneIndex = doneSets.length - 1;
  const answeredUpTo = performed.promptAnsweredForSet ?? (performed.formCheckAnswered ? 0 : -1);
  const lastDone = doneSets[lastDoneIndex];
  const nextTarget = firstPending?.suggestedReps ?? firstPending?.reps ?? null;
  const laterAdjustment =
    item && lastDone && lastDoneIndex >= 1 && lastDoneIndex > answeredUpTo && firstPending && nextTarget !== null
      ? adjustAfterLaterSet({
          kind: exercise.kind,
          increment: exercise.increment,
          targetRPE: props.targetRPE,
          nextTargetReps: nextTarget,
          set: { weight: lastDone.weight, reps: lastDone.reps!, rpe: lastDone.rpe },
        })
      : null;
  const firstAdjustment =
    item && first && first.completedAt !== null && first.reps !== null && firstPending && lastDoneIndex === 0 && answeredUpTo < 0
      ? adjustAfterFirstSet({
          kind: exercise.kind,
          increment: exercise.increment,
          repMin: item.repMin,
          repMax: item.repMax,
          targetRPE: props.targetRPE,
          targetReps: first.suggestedReps ?? first.reps,
          nextTargetReps: firstPending.suggestedReps ?? firstPending.reps ?? first.suggestedReps ?? first.reps,
          firstSet: { weight: first.weight, reps: first.reps, rpe: first.rpe },
        })
      : null;
  const adjustment = firstAdjustment ?? laterAdjustment;
  const adjustmentAfterSet = firstAdjustment ? 0 : lastDoneIndex;
  const showAdjustment = adjustment !== null && !(adjustment.kind === 'increase' && props.lightSession);

  // §7.5 — bonus set of "2-3 series" items: only on a good day, when the last set was not
  // harder than planned.
  const bonusOffered =
    !!item &&
    item.optionalExtraSets > 0 &&
    finished &&
    sets.length === item.baseSets &&
    bonusSetAllowed({
      lastSetRpe: sets.at(-1)?.rpe ?? null,
      lastSetReps: sets.at(-1)?.reps ?? null,
      repMin: item.repMin,
      targetRPE: props.targetRPE,
      readiness: props.readiness,
      lightSession: props.lightSession,
    });

  const timed = exercise.kind === 'timed';
  const repsUnit = timed ? 's' : exercise.isUnilateral ? 'reps/lado' : 'reps';
  const rest = item?.restSeconds ?? exercise.defaultRestSeconds;
  const range = item ? formatRepTarget(item.repMin, item.repMax, timed) : '';
  const target = suggestion ? formatTarget(suggestion, exercise.kind, exercise.isUnilateral) : null;

  return (
    <article className={`${styles.card} ${expanded ? styles.cardOpen : ''} ${performed.skipped ? styles.cardSkipped : ''}`}>
      <button type="button" className={styles.cardHeader} onClick={onToggle} aria-expanded={expanded}>
        <span className={styles.cardTitle}>
          <span className={styles.exerciseName}>{exercise.name}</span>
          <span className={styles.cardMeta}>
            {item ? `${item.baseSets}${item.optionalExtraSets ? '-' + (item.baseSets + item.optionalExtraSets) : ''} × ${range}` : ''} ·
            descanso {formatSeconds(rest)}
          </span>
        </span>
        <span className={`${styles.progress} ${finished ? styles.progressDone : ''}`}>
          {performed.skipped ? 'Saltado' : `${doneCount}/${sets.length}`}
        </span>
      </button>

      {expanded && !performed.skipped && (
        <div className={styles.cardBody}>
          <div className={styles.infoLines}>
            <p>
              <span className={styles.infoLabel}>La última vez:</span>{' '}
              {last ? formatPerformance(last.sets, exercise.kind) : last === null ? 'primera vez' : '…'}
            </p>
            {target && (
              <p>
                <span className={styles.infoLabel}>Hoy:</span> <strong>{target}</strong>
              </p>
            )}
            {suggestion?.hint && <p className={styles.hint}>{suggestion.hint}</p>}
            {exercise.machineSettings && (
              <p>
                <span className={styles.infoLabel}>Máquina:</span> {exercise.machineSettings}
              </p>
            )}
          </div>

          {warmups.length > 0 && (
            <div className={styles.warmups}>
              <span className={styles.warmupTitle}>Calentamiento (no cuenta)</span>
              {warmups.map((w) => {
                const done = w.completedAt !== null;
                return (
                  <button
                    key={w.id}
                    type="button"
                    className={`${styles.warmupRow} ${done ? styles.setDone : ''}`}
                    onClick={() => void toggleWarmupDone(db, w.id, Date.now())}
                    aria-pressed={done}
                  >
                    <span className={styles.setValues}>{describe(w, exercise, repsUnit)}</span>
                    <span className={done ? styles.rpeBadge : styles.pending}>{done ? 'Hecho ✓' : 'Tocar al terminar'}</span>
                  </button>
                );
              })}
            </div>
          )}

          <ol className={styles.sets}>
            {sets.map((set, i) => {
              const done = set.completedAt !== null;
              const focused = set.id === focusedId;
              if (!focused) {
                return (
                  <li key={set.id}>
                    <button type="button" className={`${styles.setCompact} ${done ? styles.setDone : ''}`} onClick={() => setFocusedSetId(set.id)}>
                      <span className={styles.setIndex}>{i + 1}</span>
                      <span className={styles.setValues}>{describe(set, exercise, repsUnit)}</span>
                      {done ? (
                        <span className={styles.rpeBadge}>RPE {set.rpe !== null ? formatNumber(set.rpe) : '—'}</span>
                      ) : (
                        <span className={styles.pending}>Pendiente</span>
                      )}
                    </button>
                  </li>
                );
              }
              return (
                <li key={set.id} className={`${styles.setEditor} ${done ? styles.setEditorDone : ''}`}>
                  <div className={styles.setEditorHead}>
                    <span>
                      Serie {i + 1}
                      {done && ' · hecha ✓'}
                    </span>
                    <button type="button" className={styles.linkButton} onClick={() => props.onRemoveSet(set)}>
                      Eliminar
                    </button>
                  </div>
                  <div className={timed ? styles.steppersOne : styles.steppers}>
                    {!timed && (
                      <Stepper
                        label="peso"
                        unit="kg"
                        decimal
                        value={set.weight}
                        step={exercise.increment}
                        allowEmpty={exercise.kind === 'bodyweight' || set.weight === null}
                        min={exercise.increment}
                        onChange={(weight) => void updateSetValues(db, set.id, { weight })}
                      />
                    )}
                    <Stepper
                      label={timed ? 'segundos' : 'repeticiones'}
                      unit={repsUnit}
                      value={set.reps}
                      step={timed ? exercise.increment : 1}
                      min={timed ? exercise.increment : 1}
                      onChange={(reps) => void updateSetValues(db, set.id, { reps })}
                    />
                  </div>
                  {done ? (
                    <button type="button" className={styles.secondaryWide} onClick={() => props.onEditRpe(set)}>
                      RPE {set.rpe !== null ? formatNumber(set.rpe) : '—'} · cambiar
                    </button>
                  ) : (
                    <button type="button" className={styles.doneButton} disabled={set.reps === null} onClick={() => {
                        setFocusedSetId(null); // next pending set gets the editor once this one is done
                        props.onDone(set);
                      }}
                    >
                      Hecho
                    </button>
                  )}
                </li>
              );
            })}
          </ol>

          {showAdjustment && adjustment && (
            <div className={adjustment.kind === 'increase' ? styles.promptGood : styles.promptHard} role="status">
              <p>
                {adjustment.kind === 'increase'
                  ? `Hoy vas fuerte: ¿subir a ${formatKg(adjustment.weight)} × ${adjustment.reps}?`
                  : adjustmentAfterSet === 0
                    ? `Día duro: ¿bajar a ${formatKg(adjustment.weight)} × ${adjustment.reps}?`
                    : `Esta serie costó mucho: ¿bajar a ${formatKg(adjustment.weight)} × ${adjustment.reps} para la siguiente?`}
              </p>
              <div className={styles.promptActions}>
                <button type="button" className={styles.promptYes} onClick={() => void answerFormCheck(db, performed.id, adjustment, adjustmentAfterSet)}>
                  Sí
                </button>
                <button type="button" className={styles.promptNo} onClick={() => void answerFormCheck(db, performed.id, null, adjustmentAfterSet)}>
                  No
                </button>
              </div>
            </div>
          )}

          {bonusOffered && (
            <button type="button" className={styles.bonusButton} onClick={() => void addSet(db, performed.id).then(setFocusedSetId)}>
              + Serie extra (opcional) · hoy vas bien
            </button>
          )}

          <div className={styles.cardActions}>
            <button type="button" className={styles.chip} onClick={() => void addSet(db, performed.id).then(setFocusedSetId)}>
              + Serie
            </button>
            <button type="button" className={styles.chip} onClick={() => setSheet('info')}>
              Ficha
            </button>
            <button type="button" className={styles.chip} onClick={() => setSheet('swap')}>
              Cambiar
            </button>
            <button type="button" className={styles.chip} onClick={() => setNoteOpen((o) => !o)}>
              Nota
            </button>
            <button type="button" className={styles.chip} onClick={() => void setExerciseSkipped(db, performed.id, true)}>
              Saltar
            </button>
          </div>

          {noteOpen && (
            <textarea
              className={styles.note}
              placeholder="Nota rápida (sensaciones, ajustes…)"
              defaultValue={performed.note}
              rows={2}
              onChange={(e) => void setExerciseNote(db, performed.id, e.target.value)}
            />
          )}
        </div>
      )}

      {expanded && performed.skipped && (
        <div className={styles.cardBody}>
          <button type="button" className={styles.secondaryWide} onClick={() => void setExerciseSkipped(db, performed.id, false)}>
            Retomar ejercicio
          </button>
        </div>
      )}

      {sheet && (
        <ExerciseSheet
          exercise={exercise}
          swapMode={sheet === 'swap'}
          canSwap={canSwap}
          onSwap={(id) => {
            setSheet(null);
            setFocusedSetId(null);
            void swapExercise(db, performed.id, id);
          }}
          onClose={() => setSheet(null)}
        />
      )}
    </article>
  );
}

function describe(set: SetEntry, exercise: Exercise, repsUnit: string): string {
  const reps = set.reps === null ? '—' : String(set.reps);
  if (exercise.kind === 'timed') return `${reps} s`;
  if (set.weight === null) return `${reps} ${repsUnit}`;
  return `${formatKg(set.weight)} × ${reps}`;
}
