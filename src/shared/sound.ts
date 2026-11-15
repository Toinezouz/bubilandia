/**
 * Rest-timer beeps with the Web Audio API (§3, §6.3).
 *
 * iOS only lets audio play after a user gesture: `unlockAudio()` must be called from a tap
 * ("Empezar sesión", and any tap in the workout screen after a reload). It is cheap to call
 * again. On iOS 17+, `navigator.audioSession.type = 'playback'` lets the beeps play even with
 * the silent switch on; on older versions the full-screen flash is the fallback signal.
 */

interface AudioSessionNavigator {
  audioSession?: { type: string };
}

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/** Call from a user gesture. Safe to call often. */
export function unlockAudio(): void {
  try {
    const session = (navigator as AudioSessionNavigator).audioSession;
    if (session && session.type !== 'playback') session.type = 'playback';
  } catch {
    // Not supported: ignore.
  }
  const audio = getContext();
  if (!audio) return;
  if (audio.state !== 'running') void audio.resume();
  // A silent, 1-sample buffer started inside the gesture fully unlocks older iOS versions.
  const buffer = audio.createBuffer(1, 1, 22050);
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  source.start(0);
}

function tone(audio: AudioContext, at: number, frequency: number, duration: number, volume: number): void {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  // Short attack/release: no clicks.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.01);
  gain.gain.setValueAtTime(volume, at + duration - 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

/** 'end': three clear beeps. 'warning': one short, softer beep (10 s left). */
export function playBeep(kind: 'end' | 'warning'): void {
  const audio = getContext();
  if (!audio) return;
  if (audio.state !== 'running') void audio.resume();
  const t = audio.currentTime + 0.02;
  if (kind === 'warning') {
    tone(audio, t, 660, 0.12, 0.35);
    return;
  }
  for (let i = 0; i < 3; i++) tone(audio, t + i * 0.28, 880, 0.18, 0.6);
}
