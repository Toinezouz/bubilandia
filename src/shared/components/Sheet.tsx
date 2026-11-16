import { useEffect, useRef, type ReactNode } from 'react';
import { lockScroll } from '../scrollLock.ts';
import styles from './components.module.css';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/** Bottom sheet: thumb-reachable, closes on backdrop tap or Escape. */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  // Parents pass a new onClose on every render (the workout screen re-renders every second
  // while the rest timer runs): keep it in a ref so the effects below only follow `open`.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    // The page behind must not scroll while the sheet is open.
    const unlock = lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      unlock();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        {title && <h2 className={styles.sheetTitle}>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Every destructive or unusual action goes through this (§8). */
export function ConfirmSheet({ open, title, message, confirmLabel, cancelLabel = 'Cancelar', danger, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Sheet open={open} onClose={onCancel} title={title}>
      {message && <p className={styles.sheetText}>{message}</p>}
      <div className={styles.sheetActions}>
        <button type="button" className={danger ? styles.dangerButton : styles.primaryButton} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </Sheet>
  );
}
