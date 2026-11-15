import { describe, expect, it } from 'vitest';
import { addIncrements, reduceByFraction, roundToIncrement, toHundredths } from '../../src/engine/weight.ts';

describe('toHundredths', () => {
  it('absorbs float noise', () => {
    expect(toHundredths(0.1 + 0.2)).toBe(30);
    expect(toHundredths(1.25)).toBe(125);
    expect(toHundredths(42.5)).toBe(4250);
  });
});

describe('roundToIncrement', () => {
  it.each([
    // [kg, increment, expected]
    [41, 2.5, 40],
    [41.25, 2.5, 40], // exactly half → down
    [41.3, 2.5, 42.5],
    [42.5, 1, 42], // half → down
    [42.6, 1, 43],
    [40, 1.25, 40],
    [40.6, 1.25, 40],
    [40.625, 1.25, 40], // half of 1.25 → down
    [40.7, 1.25, 41.25],
    [47.5, 5, 45], // half → down
    [48, 5, 50],
    [0.1 + 0.2, 0.1, 0.3],
    [0.1 + 0.2 + 2.2, 2.5, 2.5],
  ])('%f kg with %f kg steps → %f', (kg, increment, expected) => {
    expect(roundToIncrement(kg, increment)).toBe(expected);
  });

  it('never goes below one increment', () => {
    expect(roundToIncrement(0.4, 2.5)).toBe(2.5);
    expect(roundToIncrement(0, 1)).toBe(1);
    expect(roundToIncrement(-5, 2.5)).toBe(2.5);
  });

  it('rejects a non-positive increment', () => {
    expect(() => roundToIncrement(10, 0)).toThrow();
  });
});

describe('addIncrements', () => {
  it('adds exact multiples without float drift', () => {
    expect(addIncrements(41.25, 1.25, 1)).toBe(42.5);
    expect(addIncrements(0.1, 0.2, 1)).toBe(0.3);
    expect(addIncrements(40, 2.5, 2)).toBe(45);
    expect(addIncrements(40, 2.5, -1)).toBe(37.5);
  });

  it('never goes below one increment', () => {
    expect(addIncrements(2.5, 2.5, -1)).toBe(2.5);
    expect(addIncrements(5, 5, -3)).toBe(5);
  });
});

describe('reduceByFraction', () => {
  it('removes ~5 % rounded to the increment', () => {
    expect(reduceByFraction(40, 2.5, 0.05)).toBe(37.5);
    expect(reduceByFraction(100, 5, 0.05)).toBe(95);
    expect(reduceByFraction(60, 1, 0.1)).toBe(54);
  });

  it('always removes at least one increment', () => {
    // 20 × 0.95 = 19 → rounds back up to 20, so one increment is forced.
    expect(reduceByFraction(20, 2.5, 0.05)).toBe(17.5);
    expect(reduceByFraction(10, 1.25, 0.05)).toBe(8.75);
  });

  it('stays at the minimum load', () => {
    expect(reduceByFraction(2.5, 2.5, 0.05)).toBe(2.5);
  });
});
