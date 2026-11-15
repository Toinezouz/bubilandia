import { describe, expect, it } from 'vitest';
import { isIos, isIosOtherBrowser, isStandalone, shouldShowInstallHelp } from '../src/shared/platform.ts';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0 Mobile/15E148 Safari/604.1';
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36';

describe('isIos', () => {
  it('recognises iPhone and iPadOS, not desktops', () => {
    expect(isIos(IPHONE_SAFARI, 5)).toBe(true);
    expect(isIos(IPAD_DESKTOP_MODE, 5)).toBe(true);
    expect(isIos(IPAD_DESKTOP_MODE, 0)).toBe(false); // a real Mac
    expect(isIos(WINDOWS_CHROME, 0)).toBe(false);
  });

  it('spots other browsers on iOS', () => {
    expect(isIosOtherBrowser(IPHONE_CHROME)).toBe(true);
    expect(isIosOtherBrowser(IPHONE_SAFARI)).toBe(false);
  });
});

describe('shouldShowInstallHelp', () => {
  const base = { standalone: false, ios: true, forced: false, dismissedThisVisit: false };
  it('shows in a Safari tab on iPhone', () => expect(shouldShowInstallHelp(base)).toBe(true));
  it('hides in the installed app', () => expect(shouldShowInstallHelp({ ...base, standalone: true })).toBe(false));
  it('hides on a computer', () => expect(shouldShowInstallHelp({ ...base, ios: false })).toBe(false));
  it('hides once she chose to stay in the tab', () => expect(shouldShowInstallHelp({ ...base, dismissedThisVisit: true })).toBe(false));
  it('can be forced with ?instalar', () => expect(shouldShowInstallHelp({ ...base, ios: false, forced: true })).toBe(true));
});

const media = (matches: boolean) => () => ({ matches });

describe('isStandalone', () => {
  it('is true when iOS reports navigator.standalone', () => {
    expect(isStandalone({ standalone: true }, media(false))).toBe(true);
  });

  it('is true when display-mode is standalone', () => {
    expect(isStandalone({}, media(true))).toBe(true);
  });

  it('is false in a regular Safari tab', () => {
    expect(isStandalone({ standalone: false }, media(false))).toBe(false);
    expect(isStandalone({}, media(false))).toBe(false);
  });
});
