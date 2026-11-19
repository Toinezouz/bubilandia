/** Spanish display formatting (decimal comma). */

import type { ExerciseKind, PerformedSet, Suggestion } from '../engine/index.ts';

export function formatNumber(n: number): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}

export function formatKg(kg: number): string {
  return `${formatNumber(kg)} kg`;
}

/** Accepts "42,5", "42.5", " 42 ". Returns null for anything that is not a number ≥ 0. */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function range(min: number, max: number): string {
  return min === max ? `${min}` : `${min}-${max}`;
}

/** [10, 10, 9] → "10, 10, 9". */
function list(values: number[]): string {
  return values.join(', ');
}

/**
 * Last performance, e.g. "40 kg × 10, 10, 9", "40 kg × 10 · 42,5 kg × 9, 8",
 * "10, 9, 9 reps" (no load), "45, 45, 40 s" (timed).
 */
export function formatPerformance(sets: ReadonlyArray<PerformedSet>, kind: ExerciseKind): string {
  if (sets.length === 0) return '—';
  if (kind === 'timed') return `${list(sets.map((s) => s.reps))} s`;

  const groups: { weight: number | null; reps: number[] }[] = [];
  for (const s of sets) {
    const last = groups[groups.length - 1];
    if (last && last.weight === s.weight) last.reps.push(s.reps);
    else groups.push({ weight: s.weight, reps: [s.reps] });
  }
  return groups
    .map((g) => (g.weight === null ? `${list(g.reps)} reps` : `${formatKg(g.weight)} × ${list(g.reps)}`))
    .join(' · ');
}

/** Today's target, e.g. "42,5 kg × 8-10", "40 kg × 11, 10, 9", "35-50 s". Null when calibrating. */
export function formatTarget(s: Suggestion, kind: ExerciseKind, isUnilateral = false): string | null {
  if (s.decision === 'calibrate') return null;
  const side = isUnilateral ? ' / lado' : '';
  const reps =
    s.perSetReps && new Set(s.perSetReps).size > 1 ? list(s.perSetReps) : s.perSetReps ? `${s.perSetReps[0]}` : range(s.repRange.min, s.repRange.max);
  if (kind === 'timed') return `${reps} s${side}`;
  if (s.weight === null) return `${reps} reps${side}`;
  return `${formatKg(s.weight)} × ${reps}${side}`;
}

/** 52 min → "52 min", 65 min → "1 h 05 min". */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** "sáb, 14 nov" (adds the year when it is not the current one). */
export function formatDate(ms: number, now: number = Date.now()): string {
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Date(ms).toLocaleDateString('es-ES', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "3 de diciembre" (adds "de 2025" when it is not the current year). */
export function formatLongDate(ms: number, now: number = Date.now()): string {
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Date(ms).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** "18:05" */
export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

/** 12450 → "12.450 kg" */
export function formatVolume(kg: number): string {
  return `${Math.round(kg).toLocaleString('es-ES')} kg`;
}

/** Template target: fixed "12" / "40 s", or a range "8-12" for programs edited before 0.6. */
export function formatRepTarget(repMin: number, repMax: number, timed: boolean): string {
  const value = repMin === repMax ? `${repMin}` : `${repMin}-${repMax}`;
  return timed ? `${value} s` : value;
}

/** 150 → "2:30", 75 → "1:15", 45 → "0:45". */
export function formatSeconds(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
