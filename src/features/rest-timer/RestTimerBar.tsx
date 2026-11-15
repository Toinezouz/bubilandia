import { useEffect, useRef, useState } from 'react';
import { dueAlert, restView, type FiredAlerts, type RestTimer } from '../../engine/index.ts';
import { formatSeconds } from '../../shared/format.ts';
import { playBeep } from '../../shared/sound.ts';
import styles from './rest-timer.module.css';

interface RestTimerBarProps {
  rest: RestTimer | null;
  /** "Prensa sentada · Serie 2: 50 kg × 10", null when nothing is left. */
  nextLabel: string | null;
  soundEnabled: boolean;
  warningEnabled: boolean;
  onAdjust: (deltaSeconds: number) => void;
  onSkip: () => void;
  onDismiss: () => void;
}

const FLASH_MS = 1600;

/**
 * Fixed bottom bar (§6.3). Recomputed from `endsAt` on every animation frame and when the app
 * returns to the foreground; it re-renders only when the displayed second changes.
 */
export function RestTimerBar({ rest, nextLabel, soundEnabled, warningEnabled, onAdjust, onSkip, onDismiss }: RestTimerBarProps) {
  const [now, setNow] = useState(() => Date.now());
  const [flashing, setFlashing] = useState(false);
  const fired = useRef<{ key: number | null; alerts: FiredAlerts }>({ key: null, alerts: { warning: false, end: false } });
  const settings = useRef({ soundEnabled, warningEnabled });
  settings.current = { soundEnabled, warningEnabled };

  useEffect(() => {
    if (!rest) return;
    if (fired.current.key !== rest.startedAt) {
      fired.current = { key: rest.startedAt, alerts: { warning: false, end: false } };
    }
    let frame = 0;
    let shown = '';
    let flashTimer = 0;

    const tick = () => {
      const t = Date.now();
      const alert = dueAlert(rest, t, fired.current.alerts, settings.current.warningEnabled);
      if (alert === 'end') {
        fired.current.alerts.end = true;
        if (settings.current.soundEnabled) playBeep('end');
        setFlashing(true);
        window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => setFlashing(false), FLASH_MS);
      } else if (alert === 'warning') {
        fired.current.alerts.warning = true;
        if (settings.current.soundEnabled) playBeep('warning');
      }
      const v = restView(rest, t);
      const key = v.phase === 'running' ? `r${v.remainingSeconds}` : `e${v.overtimeSeconds}`;
      if (key !== shown) {
        shown = key;
        setNow(t);
      }
      frame = requestAnimationFrame(tick);
    };

    // rAF pauses in the background; recompute at once when she comes back.
    const onVisible = () => document.visibilityState === 'visible' && setNow(Date.now());
    document.addEventListener('visibilitychange', onVisible);
    tick();
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(flashTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [rest]);

  if (!rest) return null;
  const view = restView(rest, now);

  return (
    <>
      {flashing && <div className={styles.flash} aria-hidden />}
      <div className={`${styles.bar} ${view.phase === 'ended' ? styles.ended : ''}`} role="timer" aria-live="off">
        {view.phase === 'running' ? (
          <>
            <div className={styles.progress} style={{ transform: `scaleX(${view.progress})` }} />
            <div className={styles.row}>
              <div className={styles.timeBlock}>
                <span className={styles.label}>Descanso</span>
                <span className={styles.time}>{formatSeconds(view.remainingSeconds)}</span>
              </div>
              <div className={styles.controls}>
                <button type="button" className={styles.control} onClick={() => onAdjust(-15)}>
                  −15 s
                </button>
                <button type="button" className={styles.control} onClick={() => onAdjust(15)}>
                  +15 s
                </button>
                <button type="button" className={styles.skip} onClick={onSkip}>
                  Saltar
                </button>
              </div>
            </div>
            {nextLabel && <p className={styles.next}>Siguiente: {nextLabel}</p>}
          </>
        ) : (
          <div className={styles.row}>
            <div className={styles.endedText}>
              <strong className={styles.go}>{nextLabel ? '¡A por la siguiente serie!' : 'Descanso terminado'}</strong>
              {nextLabel && <span className={styles.nextEnded}>{nextLabel}</span>}
              {view.overtimeSeconds >= 5 && (
                <span className={styles.overtime}>Descanso terminado hace {formatSeconds(view.overtimeSeconds)}</span>
              )}
            </div>
            <button type="button" className={styles.dismiss} aria-label="Cerrar" onClick={onDismiss}>
              ✕
            </button>
          </div>
        )}
      </div>
    </>
  );
}
