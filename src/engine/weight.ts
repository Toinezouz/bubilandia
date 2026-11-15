/**
 * Load arithmetic (§7.2).
 *
 * All computations happen in integer hundredths of kg ("centikilos"): 1.25 kg = 125.
 * Tenths are not enough because of 1.25 kg increments. Inputs and outputs stay in kg.
 */

/** kg → integer hundredths of kg. Absorbs float noise (0.1 + 0.2 → 30). */
export function toHundredths(kg: number): number {
  return Math.round(kg * 100);
}

export function fromHundredths(hundredths: number): number {
  return hundredths / 100;
}

/**
 * Rounds a load to the nearest multiple of the increment, ties going down.
 * Never returns less than one increment (a suggested load is never 0 or negative).
 */
export function roundToIncrement(kg: number, increment: number): number {
  const step = toHundredths(increment);
  if (step <= 0) throw new Error(`Invalid increment: ${increment}`);
  // Compare in thousandths: half of 1.25 kg is 0.625 kg, which hundredths cannot represent.
  const value = Math.round(kg * 1000);
  const step1000 = step * 10;
  let steps = Math.floor(value / step1000);
  const remainder = value - steps * step1000;
  if (remainder * 2 > step1000) steps += 1; // strictly above half → up; exactly half → down
  return fromHundredths(Math.max(steps, 1) * step);
}

/** load + n × increment (n may be negative), exact, never below one increment. */
export function addIncrements(kg: number, increment: number, n: number): number {
  const step = toHundredths(increment);
  return fromHundredths(Math.max(toHundredths(kg) + n * step, step));
}

/**
 * Reduces a load by `fraction` (0.05 = −5 %), rounded to the increment, and always at least
 * one increment lighter than the original — unless it is already at the minimum (one increment).
 */
export function reduceByFraction(kg: number, increment: number, fraction: number): number {
  const rounded = roundToIncrement(kg * (1 - fraction), increment);
  const oneLess = addIncrements(kg, increment, -1);
  return Math.min(rounded, oneLess);
}
