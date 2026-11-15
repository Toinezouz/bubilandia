/** Minimal shapes so the detection stays testable without a DOM. */
export interface NavigatorLike {
  /** iOS Safari only: true when launched from the home screen. */
  standalone?: boolean;
}
export type MatchMediaLike = (query: string) => { matches: boolean };

/**
 * True when the app runs as an installed PWA (home-screen icon), false in a Safari tab.
 * iOS exposes `navigator.standalone`; other browsers expose the `display-mode` media query.
 */
export function isStandalone(nav: NavigatorLike, matchMedia: MatchMediaLike): boolean {
  if (nav.standalone === true) return true;
  return matchMedia('(display-mode: standalone)').matches;
}

/** iPhone / iPod / iPad, including iPadOS which reports itself as a Mac with a touch screen. */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** Chrome, Firefox, Edge… on iOS: installing works best from Safari. */
export function isIosOtherBrowser(userAgent: string): boolean {
  return /CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
}

/**
 * The install help page (§3) is shown on iOS when the app runs in a browser tab instead of
 * from the home-screen icon. `?instalar` forces it (to check it from a computer); she can
 * also choose to keep using the tab for the current visit.
 */
export function shouldShowInstallHelp(input: {
  standalone: boolean;
  ios: boolean;
  forced: boolean;
  dismissedThisVisit: boolean;
}): boolean {
  if (input.forced) return true;
  return input.ios && !input.standalone && !input.dismissedThisVisit;
}
