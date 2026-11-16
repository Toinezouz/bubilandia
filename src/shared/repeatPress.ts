/**
 * Press behaviour of the − / + buttons, independent from React so it can be tested.
 *
 * - A tap steps once, on release (the `click`). Nothing happens on touch-down: starting a
 *   scroll with the finger on a button must not change the value (the browser then cancels
 *   the pointer and never sends a click).
 * - Holding still for `delay` ms starts a fast repeat; the click that follows the hold is
 *   swallowed so releasing does not add one more step.
 */
export interface RepeatPress {
  down: () => void;
  /** Pointer released, cancelled (scroll took over) or moved off the button. */
  stop: () => void;
  click: () => void;
}

export function createRepeatPress(step: () => void, delay = 400, every = 75): RepeatPress {
  let delayTimer: ReturnType<typeof setTimeout> | undefined;
  let repeatTimer: ReturnType<typeof setInterval> | undefined;
  let repeated = false;

  const stop = () => {
    clearTimeout(delayTimer);
    clearInterval(repeatTimer);
  };
  return {
    down() {
      stop();
      repeated = false;
      delayTimer = setTimeout(() => {
        repeated = true;
        step();
        repeatTimer = setInterval(step, every);
      }, delay);
    },
    stop,
    click() {
      stop();
      if (repeated) {
        repeated = false;
        return;
      }
      step();
    },
  };
}
