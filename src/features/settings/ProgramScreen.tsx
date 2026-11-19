import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { db } from '../../db/database.ts';
import {
  addTemplateItem,
  createExercise,
  moveTemplateItem,
  removeTemplateItem,
  updateExercise,
  updateExerciseIncrement,
  updateTemplateItem,
} from '../../db/program.ts';
import { MUSCLE_LABELS, MUSCLES, type Exercise, type TemplateItem } from '../../db/types.ts';
import { getActiveWorkout } from '../../db/workouts.ts';
import { ConfirmSheet, Sheet } from '../../shared/components/Sheet.tsx';
import { Stepper } from '../../shared/components/Stepper.tsx';
import { formatNumber, formatRepTarget, formatSeconds, parseDecimal } from '../../shared/format.ts';
import { ExerciseForm } from '../exercises/ExerciseForm.tsx';
import styles from './settings.module.css';

interface ProgramScreenProps {
  templateId: string;
  onBack: () => void;
}

/** Common load steps: micro plates, dumbbell pairs, machine stacks, barbell plates. */
const WEIGHT_STEPS = [0.5, 1, 1.25, 2, 2.5, 3, 4, 5, 7.5, 10];
/** Common time steps for timed exercises (seconds). */
const TIME_STEPS = [2, 5, 10, 15];
const MAX_WEIGHT_STEP = 20;
const MAX_TIME_STEP = 60;

/** Edit one session of the program (§6.6): sets, reps, rest, load step, order, add/remove. */
export function ProgramScreen({ templateId, onBack }: ProgramScreenProps) {
  const data = useLiveQuery(async () => {
    const template = await db.sessionTemplates.get(templateId);
    const exercises = await db.exercises.toArray();
    return { template, exercises: new Map(exercises.map((e) => [e.id, e])), active: await getActiveWorkout(db) };
  }, [templateId]);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<TemplateItem | null>(null);
  const [form, setForm] = useState<{ exercise?: Exercise } | null>(null);

  if (!data?.template) return <main className={styles.page} aria-busy="true" />;
  const { template, exercises, active } = data;
  const items = [...template.items].sort((a, b) => a.order - b.order);
  const locked = !!active;
  const update = (order: number, patch: Partial<TemplateItem>) => void updateTemplateItem(db, templateId, order, patch);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          ‹ Ajustes
        </button>
        <h1 className={styles.title}>
          {template.code} · {template.name}
        </h1>
      </header>

      {locked && <p className={styles.notice}>Termina la sesión en curso para poder editar el programa.</p>}

      <ol className={styles.items}>
        {items.map((item) => {
          const ex = exercises.get(item.exerciseId);
          if (!ex) return null;
          const timed = ex.kind === 'timed';
          const isOpen = open === item.order;
          return (
            <li key={`${item.order}-${item.exerciseId}`} className={styles.item}>
              <button type="button" className={styles.itemHead} onClick={() => setOpen(isOpen ? null : item.order)} aria-expanded={isOpen}>
                <span className={styles.itemName}>{ex.name}</span>
                <span className={styles.meta}>
                  {item.baseSets}
                  {item.optionalExtraSets ? `-${item.baseSets + 1}` : ''} × {formatRepTarget(item.repMin, item.repMax, timed)} ·{' '}
                  {formatSeconds(item.restSeconds)} · +{formatNumber(ex.increment)} {timed ? 's' : 'kg'}
                </span>
              </button>

              {isOpen && (
                <fieldset className={styles.editor} disabled={locked}>
                  <Row label="Series">
                    <Stepper label="series" value={item.baseSets} step={1} min={1} onChange={(v) => v && update(item.order, { baseSets: v })} />
                  </Row>
                  <label className={styles.toggle}>
                    <span>+1 serie extra opcional (en días buenos)</span>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={item.optionalExtraSets === 1}
                      onChange={(e) => update(item.order, { optionalExtraSets: e.target.checked ? 1 : 0 })}
                    />
                  </label>
                  <Row label={timed ? 'Segundos por serie' : 'Repeticiones por serie'}>
                    <Stepper
                      label={timed ? 'segundos' : 'repeticiones'}
                      value={item.repMin}
                      step={timed ? 5 : 1}
                      min={timed ? 5 : 1}
                      onChange={(v) => v && update(item.order, { repMin: v, repMax: v })}
                    />
                  </Row>
                  <Row label="Descanso (s)">
                    <Stepper label="descanso" value={item.restSeconds} step={15} min={0} onChange={(v) => v !== null && update(item.order, { restSeconds: v })} />
                  </Row>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>
                      Incremento ({timed ? 's' : 'kg'})
                      <span className={styles.hintSmall}>(este ejercicio, en todas las sesiones)</span>
                    </span>
                    <div className={styles.choiceRow} role="radiogroup" aria-label="Incremento">
                      {(timed ? TIME_STEPS : WEIGHT_STEPS).map((step) => (
                        <button
                          key={step}
                          type="button"
                          role="radio"
                          aria-checked={ex.increment === step}
                          className={`${styles.choice} ${ex.increment === step ? styles.choiceOn : ''}`}
                          onClick={() => void updateExerciseIncrement(db, ex.id, step)}
                        >
                          {formatNumber(step)}
                        </button>
                      ))}
                    </div>
                    <CustomIncrement
                      key={`${ex.id}-${ex.increment}`}
                      value={ex.increment}
                      unit={timed ? 's' : 'kg'}
                      isCustom={!(timed ? TIME_STEPS : WEIGHT_STEPS).includes(ex.increment)}
                      max={timed ? MAX_TIME_STEP : MAX_WEIGHT_STEP}
                      onSave={(v) => void updateExerciseIncrement(db, ex.id, v)}
                    />
                  </div>
                  <button type="button" className={styles.smallButton} onClick={() => setForm({ exercise: ex })}>
                    Editar ejercicio (nombre, músculos…)
                  </button>
                  <div className={styles.itemActions}>
                    <button type="button" className={styles.smallButton} disabled={item.order === 0} onClick={() => { setOpen(item.order - 1); void moveTemplateItem(db, templateId, item.order, -1); }}>
                      ↑ Subir
                    </button>
                    <button
                      type="button"
                      className={styles.smallButton}
                      disabled={item.order === items.length - 1}
                      onClick={() => { setOpen(item.order + 1); void moveTemplateItem(db, templateId, item.order, 1); }}
                    >
                      ↓ Bajar
                    </button>
                    <button type="button" className={styles.dangerSmall} disabled={items.length <= 1} onClick={() => setRemoving(item)}>
                      Quitar
                    </button>
                  </div>
                </fieldset>
              )}
            </li>
          );
        })}
      </ol>

      <button type="button" className={styles.addButton} disabled={locked} onClick={() => setAdding(true)}>
        + Añadir ejercicio
      </button>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Añadir ejercicio">
        <button
          type="button"
          className={styles.addButton}
          onClick={() => {
            setAdding(false);
            setForm({});
          }}
        >
          + Crear ejercicio nuevo
        </button>
        <ExercisePicker
          exercises={[...exercises.values()].filter((e) => !items.some((i) => i.exerciseId === e.id))}
          onPick={(id) => {
            setAdding(false);
            void addTemplateItem(db, templateId, id);
          }}
        />
      </Sheet>

      <Sheet open={form !== null} onClose={() => setForm(null)} title={form?.exercise ? 'Editar ejercicio' : 'Nuevo ejercicio'}>
        {form && (
          <ExerciseForm
            exercise={form.exercise}
            existingNames={[...exercises.values()].filter((e) => e.id !== form.exercise?.id).map((e) => e.name)}
            onCancel={() => setForm(null)}
            onSave={(draft) => {
              const editing = form.exercise;
              setForm(null);
              if (editing) void updateExercise(db, editing.id, draft);
              // A new exercise is added to this session right away.
              else void createExercise(db, draft).then((id) => addTemplateItem(db, templateId, id));
            }}
          />
        )}
      </Sheet>

      <ConfirmSheet
        open={!!removing}
        title="¿Quitar este ejercicio de la sesión?"
        message="Su historial se conserva; puedes volver a añadirlo cuando quieras."
        confirmLabel="Quitar"
        danger
        onConfirm={() => {
          if (removing) void removeTemplateItem(db, templateId, removing.order);
          setRemoving(null);
          setOpen(null);
        }}
        onCancel={() => setRemoving(null)}
      />
    </main>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

function ExercisePicker({ exercises, onPick }: { exercises: Exercise[]; onPick: (id: string) => void }) {
  return (
    <div className={styles.picker}>
      {MUSCLES.map((m) => {
        const list = exercises.filter((e) => e.primaryMuscle === m).sort((a, b) => a.name.localeCompare(b.name, 'es'));
        if (list.length === 0) return null;
        return (
          <section key={m}>
            <h3 className={styles.pickerTitle}>{MUSCLE_LABELS[m]}</h3>
            {list.map((e) => (
              <button key={e.id} type="button" className={styles.pickerItem} onClick={() => onPick(e.id)}>
                {e.name}
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/** Any other step (e.g. 1,5 kg or 0,25 kg), typed with the decimal keypad and saved on blur. */
function CustomIncrement({
  value,
  unit,
  isCustom,
  max,
  onSave,
}: {
  value: number;
  unit: string;
  isCustom: boolean;
  max: number;
  onSave: (value: number) => void;
}) {
  const [text, setText] = useState(isCustom ? formatNumber(value) : '');
  const [error, setError] = useState(false);
  const commit = () => {
    if (text.trim() === '') return setError(false);
    const parsed = parseDecimal(text);
    // At most two decimals (the engine works in hundredths of kg), > 0 and not absurd.
    const valid = parsed !== null && parsed > 0 && parsed <= max && Math.abs(parsed * 100 - Math.round(parsed * 100)) < 1e-9;
    setError(!valid);
    if (valid && parsed !== value) onSave(parsed);
  };
  return (
    <label className={`${styles.customStep} ${isCustom ? styles.customStepOn : ''}`}>
      <span>Otro:</span>
      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        placeholder="p. ej. 1,5"
        value={text}
        aria-invalid={error}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span>{unit}</span>
      {error && <span className={styles.customError}>Valor entre 0,01 y {max} {unit}</span>}
    </label>
  );
}
