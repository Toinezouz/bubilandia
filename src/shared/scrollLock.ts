/**
 * Stops the page from scrolling behind an open bottom sheet. `overflow: hidden` on the body
 * is not enough on iOS Safari, so the body is pinned in place (position: fixed) at its
 * current scroll offset and restored afterwards. Locks are counted: sheets can stack.
 */
let locks = 0;
let savedScrollY = 0;

export function lockScroll(): () => void {
  if (locks === 0) {
    savedScrollY = window.scrollY;
    const { style } = document.body;
    style.position = 'fixed';
    style.top = `-${savedScrollY}px`;
    style.left = '0';
    style.right = '0';
  }
  locks++;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks--;
    if (locks > 0) return;
    const { style } = document.body;
    style.position = '';
    style.top = '';
    style.left = '';
    style.right = '';
    window.scrollTo(0, savedScrollY);
  };
}
