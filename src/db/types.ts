/**
 * Persisted data model (IndexedDB via Dexie).
 *
 * Conventions
 * - Ids are strings: stable slugs for seeded data ("hip-thrust", "pierna-a"),
 *   `crypto.randomUUID()` for everything created at runtime. Strings survive export/import as-is.
 * - Weights are stored in kg (e.g. 42.5). The engine does its arithmetic in integer
 *   hundredths of kg to avoid float drift (1.25 kg increments rule out tenths).
 * - Timestamps are epoch milliseconds (number), simpler to compare and to serialise.
 * - For `timed` exercises, `reps` / `repMin` / `repMax` / `increment` are expressed in seconds.
 */

export const MUSCLES = [
  'glutes',
  'quads',
  'hamstrings',
  'adductors',
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'core',
] as const;
export type Muscle = (typeof MUSCLES)[number];

/** Spanish labels shown in the UI. */
export const MUSCLE_LABELS: Record<Muscle, string> = {
  glutes: 'Glúteos',
  quads: 'Cuádriceps',
  hamstrings: 'Isquios',
  adductors: 'Aductores',
  chest: 'Pecho',
  back: 'Espalda',
  shoulders: 'Hombros',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  core: 'Core',
};

export type ExerciseKind = 'weighted' | 'bodyweight' | 'timed';

export interface Exercise {
  id: string;
  name: string;
  primaryMuscle: Muscle;
  /** Counted as 0.5 set in weekly volume. */
  secondaryMuscle: Muscle | null;
  kind: ExerciseKind;
  /** Reps are per side; no rest between sides. */
  isUnilateral: boolean;
  /** kg for weighted/bodyweight, seconds for timed. */
  increment: number;
  defaultRestSeconds: number;
  cues: string[];
  /** Free text, e.g. "asiento 4, respaldo 2". */
  machineSettings: string;
  alternativeIds: string[];
  notes: string;
}

export interface TemplateItem {
  exerciseId: string;
  order: number;
  baseSets: number;
  /** 1 for "2-3 series" items: a bonus set offered only on good days (§7.5). */
  optionalExtraSets: 0 | 1;
  repMin: number;
  repMax: number;
  restSeconds: number;
  /** Overrides the global target RPE when set. */
  targetRPE: number | null;
}

export interface SessionTemplate {
  id: string;
  name: string;
  /** Short label for the rotation (A, B, C, D). */
  code: string;
  /** Position in the rotation A → B → C → D → A… */
  order: number;
  /** Used for the "leg day < 48 h" warning. */
  isLegDay: boolean;
  items: TemplateItem[];
}

export type WorkoutStatus = 'in_progress' | 'done' | 'abandoned';
/** "Forma del día": alta / normal / baja. */
export type Readiness = 'high' | 'normal' | 'low';
export const READINESS_LABELS: Record<Readiness, string> = { high: 'alta', normal: 'normal', low: 'baja' };

/** Same shape as the engine's RestTimer: the timer is always derived from `endsAt`, never counted. */
export interface ActiveRest {
  startedAt: number;
  endsAt: number;
  durationSeconds: number;
}

export interface Workout {
  id: string;
  templateId: string;
  startedAt: number;
  endedAt: number | null;
  readiness: Readiness | null;
  notes: string;
  isDeload: boolean;
  status: WorkoutStatus;
  /** Running rest timer, persisted so it survives a reload / app kill. */
  activeRest: ActiveRest | null;
}

export interface PerformedExercise {
  id: string;
  workoutId: string;
  /** The exercise actually done (may be an alternative of the template's one). */
  exerciseId: string;
  /** The template item it fills, so a swapped exercise keeps its place and targets. */
  templateExerciseId: string | null;
  order: number;
  skipped: boolean;
  note: string;
}

export interface SetEntry {
  id: string;
  performedExerciseId: string;
  index: number;
  isWarmup: boolean;
  /**
   * kg; null for bodyweight sets without added load (or an empty field while calibrating).
   * Until `completedAt` is set, weight/reps hold the draft shown in the row (pre-filled from
   * the suggestion, then adjusted), saved on every change so nothing is lost on reload.
   */
  weight: number | null;
  /** Reps (or seconds for timed exercises). */
  reps: number | null;
  /** 6–10, half points allowed. */
  rpe: number | null;
  completedAt: number | null;
  suggestedWeight: number | null;
  suggestedReps: number | null;
}

export interface WeeklySetTarget {
  min: number;
  max: number;
}

export const SETTINGS_ID = 'settings';

export interface Settings {
  id: typeof SETTINGS_ID;
  targetRPE: number;
  weeklySetTargets: Record<Muscle, WeeklySetTarget>;
  soundEnabled: boolean;
  tenSecondBeep: boolean;
  warmupEnabled: boolean;
  lastExportAt: number | null;
  /** "Haz una copia de seguridad" banner closed at (snoozes it for 14 days). */
  backupReminderDismissedAt?: number | null;
  /** Version of the seeded program, to allow future program updates. */
  seedVersion: number;
}
