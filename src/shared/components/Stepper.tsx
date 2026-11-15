import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { formatNumber, parseDecimal } from '../format.ts';
import { toHundredths } from '../../engine/weight.ts';
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

const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 75;

/** − [value] + with long-press auto-repeat and keyboard entry (16px+ font, decimal keypad). */
export function Stepper({ label, value, step, min = 0, allowEmpty = false, decimal = false, unit, onChange }: StepperProps) {
  const [current, setCurrent] = useState<number | null>(value);
  const [text, setText] = useState(value === null ? '' : formatNumber(value));
  const [editing, setEditing] = useState(false);
  const currentRef = useRef(current);
  const timers = useRef<{ delay?: number; repeat?: number }>({});

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

  const stop = () => {
    window.clearTimeout(timers.current.delay);
    window.clearInterval(timers.current.repeat);
  };
  useEffect(() => stop, []);

  const pressProps = (direction: 1 | -1) => ({
    onPointerDown: (e: PointerEvent) => {
      e.preventDefault();
      bump(direction);
      stop();
      timers.current.delay = window.setTimeout(() => {
        timers.current.repeat = window.setInterval(() => bump(direction), REPEAT_EVERY_MS);
      }, REPEAT_DELAY_MS);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    // Keyboard / assistive activation (pointer clicks are handled on pointerdown).
    onClick: (e: MouseEvent) => {
      if (e.detail === 0) bump(direction);
    },
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
  });

  const commitText = () => {
    setEditing(false);
    const parsed = parseDecimal(text);
    if (parsed === null) {
      if (text.trim() === '' && allowEmpty) apply(null);
      else setText(current === null ? '' : formatNumber(current));
      return;
    }
    apply(decimal ? parsed : Math.round(parsed));
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
