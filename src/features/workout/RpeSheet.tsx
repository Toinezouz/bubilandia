import { RPE_LABELS, TARGET_ZONE } from '../../engine/index.ts';
import { formatNumber } from '../../shared/format.ts';
import { Sheet } from '../../shared/components/Sheet.tsx';
import styles from './workout.module.css';

interface RpeSheetProps {
  open: boolean;
  current?: number | null;
  onPick: (rpe: number) => void;
  onClose: () => void;
}

/** One tap = one RPE (§7.1). Target zone 7-9 is highlighted. */
export function RpeSheet({ open, current, onPick, onClose }: RpeSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="¿Cuántas te quedaban?">
      <div className={styles.rpeList}>
        {RPE_LABELS.map(({ rpe, label }) => {
          const inZone = rpe >= TARGET_ZONE.min && rpe <= TARGET_ZONE.max;
          return (
            <button
              key={rpe}
              type="button"
              className={`${styles.rpeOption} ${inZone ? styles.rpeZone : ''} ${current === rpe ? styles.rpeCurrent : ''}`}
              onClick={() => onPick(rpe)}
            >
              <span className={styles.rpeValue}>{formatNumber(rpe)}</span>
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
