/**
 * Session rotation A → B → C → D → A… (§4, §6.1), "hace X días" and the soft leg-day warning.
 * Dates are epoch milliseconds; day boundaries use the device's local time zone.
 */

export interface RotationTemplate {
  id: string;
  /** Position in the rotation. */
  order: number;
}

/**
 * The session after the last completed one, by rotation order. With no completed session
 * (or if that template no longer exists) the rotation starts from the first template.
 */
export function nextTemplateId(
  templates: ReadonlyArray<RotationTemplate>,
  lastDoneTemplateId: string | null,
): string | null {
  const sorted = [...templates].sort((a, b) => a.order - b.order);
  if (sorted.length === 0) return null;
  const index = sorted.findIndex((t) => t.id === lastDoneTemplateId);
  if (index === -1) return sorted[0]!.id;
  return sorted[(index + 1) % sorted.length]!.id;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days between two instants (0 = same day, 1 = yesterday…). */
export function calendarDaysBetween(from: number, to: number): number {
  const startOfDay = (ms: number) => {
    const d = new Date(ms);
    // Date.UTC on local components cancels DST shifts.
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

/** "hoy", "ayer", "hace 3 días"; null → "nunca". */
export function formatDaysAgo(lastAt: number | null, now: number): string {
  if (lastAt === null) return 'nunca';
  const days = calendarDaysBetween(lastAt, now);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  return `hace ${days} días`;
}

/** Leg sessions closer than this trigger the warning. */
export const LEG_REST_HOURS = 48;

/**
 * Soft, never-blocking warning when a leg session is chosen < 48 h after the previous one.
 * @param lastLegSessionAt end (or start) of the last completed leg session, null if none.
 * @returns the Spanish message, or null when there is nothing to say.
 */
export function legDayWarning(
  chosenIsLegDay: boolean,
  lastLegSessionAt: number | null,
  now: number,
): string | null {
  if (!chosenIsLegDay || lastLegSessionAt === null) return null;
  const hours = (now - lastLegSessionAt) / (60 * 60 * 1000);
  if (hours < 0 || hours >= LEG_REST_HOURS) return null;

  const days = calendarDaysBetween(lastLegSessionAt, now);
  const when = days <= 0 ? 'hoy' : days === 1 ? 'hace 1 día' : `hace ${days} días`;
  return `Hiciste piernas ${when}, ¿seguro? Mejor un día de tren superior.`;
}
