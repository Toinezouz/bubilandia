import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { formatNumber, parseDecimal } from '../format.ts';
import { toHundredths } from '../../engine/weight.ts';
import { createRepeatPress } from '../repeatPress.ts';
import styles from './components.module.css';

interface StepperProps {
  label: string;
  value: number | null;
  step: number;
  /** Smallest value reachable with "−"; below it the value becomes empty when `allowEmpty`. */
  min?: number;
  allowEmpty?: boolean;
  decimal?: boolean;
  unit?: string;
  onChange: (value: number | null) => void;
}

/**
 * − [value] + with keyboard entry (16px+ font, decimal keypad). A tap steps once on release,
 * holding a button repeats fast, and scrolling from a button changes nothing (see repeatPress).
 */
export function Stepper({ label, value, step, min = 0, allowEmpty = false, decimal = false, unit, onChange }: StepperProps) {
  const [current, setCurrent] = useState<number | null>(value);
  const [text, setText] = useState(value === null ? '' : formatNumber(value));
  const [editing, setEditing] = useState(false);
  const currentRef = useRef(current);

  // Follow external changes (e.g. accepted suggestion) unless she is typing.
  useEffect(() => {
    if (editing) return;
    currentRef.current = value;
    setCurrent(value);
    setText(value === null ? '' : formatNumber(value));
  }, [value, editing]);

  const apply = (next: number | null) => {
    currentRef.current = next;
    setCurrent(next);
    setText(next === null ? '' : formatNumber(next));
    onChange(next);
  };

  // Exact arithmetic in hundredths (2.5 + 1.25 etc.).
  const bump = (direction: 1 | -1) => {
    const cur = currentRef.current;
    if (cur === null) {
      if (direction === 1) apply(allowEmpty ? step : Math.max(min, step));
      return;
    }
    const next = (toHundredths(cur) + direction * toHundredths(step)) / 100;
    if (next < min) {
      if (allowEmpty) apply(null);
      return;
    }
    apply(next);
  };

  // The press controllers live for the whole component; they always call the latest `bump`.
  const bumpRef = useRef(bump);
  bumpRef.current = bump;
  const presses = useRef({
    minus: createRepeatPress(() => bumpRef.current(-1)),
    plus: createRepeatPress(() => bumpRef.current(1)),
  });
  useEffect(() => {
    const { minus, plus } = presses.current;
    return () => {
      minus.stop();
      plus.stop();
    };
  }, []);

  const pressProps = (direction: 1 | -1) => {
    const press = direction === 1 ? presses.current.plus : presses.current.minus;
    return {
      onPointerDown: press.down,
      onPointerUp: press.stop,
      onPointerLeave: press.stop,
      onPointerCancel: press.stop,
      onClick: press.click,
      onContextMenu: (e: MouseEvent) => e.preventDefault(),
    };
  };

  const commitText = () => {
    setEditing(false);
    const parsed = parseDecimal(text);
    if (parsed === null) {
      if (text.trim() === '' && allowEmpty) apply(null);
      else setText(current === null ? '' : formatNumber(current));
      return;
    }
    const next = decimal ? parsed : Math.round(parsed);
    // Typed values below what the buttons allow are refused (0 reps, 0 kg, 0 sets…).
    if (decimal ? next <= 0 : next < min) {
      setText(current === null ? '' : formatNumber(current));
      return;
    }
    apply(next);
  };

  return (
    <div className={styles.stepper}>
      <button type="button" className={styles.stepButton} aria-label={`Menos ${label}`} {...pressProps(-1)}>
        −
      </button>
      <label className={styles.stepValue}>
        <input
          className={styles.stepInput}
          type="text"
          inputMode={decimal ? 'decimal' : 'numeric'}
          enterKeyHint="done"
          aria-label={label}
          value={text}
          placeholder="—"
          onFocus={(e) => {
            setEditing(true);
            e.currentTarget.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {unit && <span className={styles.stepUnit}>{unit}</span>}
      </label>
      <button type="button" className={styles.stepButton} aria-label={`Más ${label}`} {...pressProps(1)}>
        +
      </button>
    </div>
  );
}
