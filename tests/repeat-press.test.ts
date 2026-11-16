import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRepeatPress } from '../src/shared/repeatPress.ts';

describe('− / + press behaviour', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a tap steps once, on release', () => {
    const step = vi.fn();
    const press = createRepeatPress(step);
    press.down();
    expect(step).not.toHaveBeenCalled(); // nothing on touch-down
    vi.advanceTimersByTime(120);
    press.stop();
    press.click();
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('starting a scroll on the button changes nothing', () => {
    const step = vi.fn();
    const press = createRepeatPress(step);
    press.down();
    vi.advanceTimersByTime(150);
    press.stop(); // pointercancel: the browser took over for scrolling, no click follows
    vi.advanceTimersByTime(2000);
    expect(step).not.toHaveBeenCalled();
  });

  it('holding repeats fast, and releasing does not add an extra step', () => {
    const step = vi.fn();
    const press = createRepeatPress(step, 400, 75);
    press.down();
    vi.advanceTimersByTime(400 + 75 * 4); // first step at 400 ms, then 4 repeats
    expect(step).toHaveBeenCalledTimes(5);
    press.stop();
    press.click(); // the click that ends the hold
    vi.advanceTimersByTime(1000);
    expect(step).toHaveBeenCalledTimes(5);
  });

  it('works again normally after a hold', () => {
    const step = vi.fn();
    const press = createRepeatPress(step);
    press.down();
    vi.advanceTimersByTime(500);
    press.stop();
    press.click();
    const afterHold = step.mock.calls.length;
    press.down();
    press.stop();
    press.click();
    expect(step).toHaveBeenCalledTimes(afterHold + 1);
  });

  it('keyboard activation (click without pointer) steps once', () => {
    const step = vi.fn();
    createRepeatPress(step).click();
    expect(step).toHaveBeenCalledTimes(1);
  });
});
