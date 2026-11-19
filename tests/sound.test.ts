// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('rest-timer sound and her music', () => {
  afterEach(() => vi.resetModules());

  it('declares an "ambient" audio session (mixes with Spotify) before creating any audio', async () => {
    const events: string[] = [];
    const session = {
      _type: 'auto',
      get type() {
        return this._type;
      },
      set type(v: string) {
        events.push(`session:${v}`);
        this._type = v;
      },
    };
    Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true });
    class FakeContext {
      state = 'suspended';
      currentTime = 0;
      destination = {};
      constructor() {
        events.push('context');
      }
      resume() {
        return Promise.resolve();
      }
      createBuffer() {
        return {};
      }
      createBufferSource() {
        return { connect() {}, start() {}, buffer: null };
      }
      createOscillator() {
        return { type: '', frequency: { value: 0 }, connect: () => ({ connect() {} }), start() {}, stop() {} };
      }
      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({}) };
      }
    }
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext;

    const { playBeep, unlockAudio } = await import('../src/shared/sound.ts');
    expect(events).toEqual([]); // importing the module (opening the app) touches nothing

    unlockAudio();
    expect(events).toEqual(['session:ambient', 'context']);
    expect(session.type).toBe('ambient');
    expect(events).not.toContain('session:playback');

    playBeep('end');
    expect(session.type).toBe('ambient');
  });
});
