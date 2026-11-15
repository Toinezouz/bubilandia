/** Backup reminder (§6.1, §6.5): a dismissible home banner every 14 days. */

export const BACKUP_REMINDER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * - Nothing to save yet (no completed session) → no banner.
 * - Never exported → banner right away (all data would be lost with the phone).
 * - Otherwise → banner once the last export is older than 14 days.
 * Closing the banner snoozes it for 14 days.
 */
export function shouldRemindBackup(input: {
  hasCompletedSessions: boolean;
  lastExportAt: number | null;
  dismissedAt: number | null;
  now: number;
}): boolean {
  const { hasCompletedSessions, lastExportAt, dismissedAt, now } = input;
  if (!hasCompletedSessions) return false;
  const window = BACKUP_REMINDER_DAYS * DAY_MS;
  if (dismissedAt !== null && now - dismissedAt < window) return false;
  if (lastExportAt === null) return true;
  return now - lastExportAt >= window;
}
