/**
 * Long-run simulations of the progression on every exercise of the real program.
 *
 * A simulated athlete has a true strength (e1RM) that grows a little every session. Each
 * set she does the prescribed reps, or stops at failure if she cannot, loses one rep per set
 * to fatigue, and logs her real RPE. Three profiles:
 * - "target": stops on the prescribed reps (honest RPE);
 * - "failure": always goes to failure (RPE 10);
 * - "days": like "target" but with good and bad days (±6 % strength, seeded random).
 */
import { describe, expect, it } from 'vitest';
import { FIXED_EXTRA_REPS, loadFor, prefillForSet, suggestNext } from '../../src/engine/progression.ts';
import { DEFAULT_TARGET_RPE } from '../../src/engine/rpe.ts';
import type { PerformedSet, RepRange } from '../../src/engine/types.ts';
import { floorToIncrement } from '../../src/engine/weight.ts';
import { SEED_EXERCISES } from '../../src/seed/exercises.ts';
import { FIXED_REPS, SEED_TEMPLATES } from '../../src/seed/templates.ts';

type Profile = 'target' | 'failure' | 'days';

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SessionLog {
  decision: string;
  weight: number;
  targets: number[];
  done: PerformedSet[];
}

function simulate(range: RepRange, increment: number, setsCount: number, profile: Profile, sessions = 40): SessionLog[] {
  const random = rng(range.min * 31 + range.max * 7 + Math.round(increment * 100));
  let e1rm = Math.max(increment * 14, 30);
  const maxReps = (w: number, strength: number) => Math.max(0, Math.floor(30 * (strength / w - 1) + 1e-9));
  const start = floorToIncrement(loadFor(e1rm, Math.round((range.min + range.max) / 2), DEFAULT_TARGET_RPE), increment);
  let last: PerformedSet[] = Array.from({ length: setsCount }, (_, i) => ({
    weight: start,
    reps: Math.max(1, Math.min(range.max, maxReps(start, e1rm) - 1) - i),
    rpe: 9,
  }));
  let previous: PerformedSet[] | undefined;
  const log: SessionLog[] = [];

  for (let s = 0; s < sessions; s++) {
    e1rm *= 1.006; // slow, realistic progress
    const today = profile === 'days' ? e1rm * (0.94 + random() * 0.12) : e1rm;
    const sug = suggestNext({ kind: 'weighted', repRange: range, increment, targetRPE: DEFAULT_TARGET_RPE, lastSets: last, previousSets: previous });
    const weight = sug.weight!;
    const targets = Array.from({ length: setsCount }, (_, i) => prefillForSet(sug, i).reps);
    const done = targets.map((target, i) => {
      const max = Math.max(0, maxReps(weight, today) - i);
      const reps = profile === 'failure' ? max : Math.min(target, max);
      return { weight, reps, rpe: Math.max(6, Math.min(10, 10 - (max - reps))) };
    });
    log.push({ decision: sug.decision, weight, targets, done });
    previous = last;
    last = done;
  }
  return log;
}

/** Invariants shared by fixed reps and ranges. */
function checkCommon(log: SessionLog[], increment: number, profile: Profile) {
  for (const [i, s] of log.entries()) {
    if (i === 0) continue;
    const prev = log[i - 1]!;
    // No absurd jump: at most +12 % (or one increment for light loads), at most −18 %.
    expect(s.weight).toBeLessThanOrEqual(Math.max(prev.weight * 1.12, prev.weight + increment) + 1e-9);
    expect(s.weight).toBeGreaterThanOrEqual(Math.min(prev.weight * 0.82, prev.weight - increment) - 1e-9);
    // No up-and-down: a load just raised is not lowered at once on a normal day.
    if (profile !== 'days' && prev.decision === 'increase') expect(s.decision, `session ${i + 1} after an increase`).not.toBe('decrease');
  }
  const weights = log.map((s) => s.weight);
  // With steady progress the load goes up (never stuck at one load for the whole period).
  if (profile !== 'days') expect(weights.at(-1)!, 'load after 40 sessions').toBeGreaterThan(weights[0]!);
  let longest = 0;
  let run = 1;
  for (let i = 1; i < weights.length; i++) {
    run = weights[i] === weights[i - 1] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  expect(longest, 'sessions in a row with the same load').toBeLessThanOrEqual(24);
  // Sets are hard, as wanted: on average the first set ends close to failure. On good days
  // she stops on the target with reps left; in the app "Hoy vas fuerte" handles those.
  const firstSetRpe = log.slice(1).map((s) => s.done[0]!.rpe!);
  const mean = firstSetRpe.reduce((a, b) => a + b, 0) / firstSetRpe.length;
  expect(mean, 'average RPE of the first set').toBeGreaterThanOrEqual(profile === 'days' ? 8.25 : 8.5);
}

// Every weighted line of the real program (fixed reps), with its increment and sets.
const items = SEED_TEMPLATES.flatMap((t) =>
  t.items.map((item) => ({ item, exercise: SEED_EXERCISES.find((e) => e.id === item.exerciseId)! })),
).filter(({ exercise }) => exercise.kind === 'weighted');

describe.each(['target', 'failure', 'days'] as Profile[])('fixed reps (the program), profile "%s"', (profile) => {
  it.each(items.map(({ item, exercise }) => [`${exercise.name} × ${item.repMin}`, item, exercise] as const))('%s', (_, item, exercise) => {
    const reps = item.repMin;
    const log = simulate({ min: reps, max: reps }, exercise.increment, item.baseSets, profile);
    for (const [i, s] of log.entries()) {
      // Always the fixed number; a few extra reps only while waiting for a load step that
      // is too big for now.
      for (const t of s.targets) {
        if (s.decision === 'add_rep') {
          expect(t, `session ${i + 1}`).toBeGreaterThan(reps);
          expect(t, `session ${i + 1}`).toBeLessThanOrEqual(reps + FIXED_EXTRA_REPS);
        } else {
          expect(t, `session ${i + 1} (${s.decision})`).toBe(reps);
        }
      }
    }
    checkCommon(log, exercise.increment, profile);
  });
});

describe.each(['target', 'failure', 'days'] as Profile[])('rep ranges (programs edited by hand), profile "%s"', (profile) => {
  const ranges = Object.entries(FIXED_REPS)
    .filter(([id]) => id !== 'plank')
    .map(([id, { from }]) => ({ id, range: { min: from[0], max: from[1] }, increment: SEED_EXERCISES.find((e) => e.id === id)!.increment }));
  it.each(ranges.map((r) => [`${r.id} ${r.range.min}-${r.range.max}`, r] as const))('%s', (_, { range, increment }) => {
    const log = simulate(range, increment, 3, profile);
    for (const s of log) {
      for (const t of s.targets) {
        expect(t).toBeGreaterThanOrEqual(range.min);
        expect(t).toBeLessThanOrEqual(range.max);
      }
    }
    checkCommon(log, increment, profile);
  });
});

describe('a coach does not overreact to daily form', () => {
  it('a bad day is followed by the same load, not by a drop then a rise', () => {
    // 60 sessions, ±5 % daily form, honest athlete stopping at the target.
    const log = simulate({ min: 10, max: 10 }, 2.5, 3, 'days', 60);
    const downThenUp = log.filter((s, i) => i > 0 && log[i - 1]!.decision === 'decrease' && s.decision === 'increase');
    expect(downThenUp).toHaveLength(0);
    // Each exercise comes back once a week: 60 sessions is more than a year. A drop only follows
    // two short sessions in a row (or a 4+ rep miss), so drops stay rare and never chain.
    const drops = log.filter((s) => s.decision === 'decrease').length;
    expect(drops).toBeLessThanOrEqual(6);
    const chained = log.filter((s, i) => i > 0 && s.decision === 'decrease' && log[i - 1]!.decision === 'decrease');
    expect(chained).toHaveLength(0);
    // A single short session is never followed by a drop.
    for (let i = 2; i < log.length; i++) {
      if (log[i]!.decision !== 'decrease') continue;
      const prevShort = (k: number) => log[k]!.done[0]!.reps + 10 - log[k]!.done[0]!.rpe! <= 8;
      const bigMiss = log[i - 1]!.done[0]!.reps + 10 - log[i - 1]!.done[0]!.rpe! <= 6;
      expect(bigMiss || (prevShort(i - 1) && prevShort(i - 2)), `session ${i + 1}`).toBe(true);
    }
  });
});

describe('the reported problems', () => {
  it('no more 18-20 rep sets: the program asks 8, 10, 12 or 15 reps', () => {
    const all = SEED_TEMPLATES.flatMap((t) => t.items.filter((i) => i.exerciseId !== 'plank').map((i) => i.repMin));
    expect(new Set(all)).toEqual(new Set([8, 10, 12, 15]));
    for (const t of SEED_TEMPLATES) for (const i of t.items) expect(i.repMin).toBe(i.repMax);
  });

  it('training to failure never blocks the load increase', () => {
    const log = simulate({ min: 15, max: 15 }, 2.5, 3, 'failure', 30);
    expect(log.at(-1)!.weight).toBeGreaterThan(log[0]!.weight);
  });
});
