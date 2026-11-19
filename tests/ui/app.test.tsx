// @vitest-environment jsdom
/**
 * Interface tests: the real <App /> rendered in a simulated DOM with a real (in-memory)
 * IndexedDB. They click through the key journeys like she would, so regressions in the
 * screens are caught, not only in the logic underneath.
 */
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom has no matchMedia, and the chart library reads it as soon as it is imported:
// install it before any app module loads.
vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  window.scrollTo = () => {};
});

// The service worker registration does not exist outside a real browser build.
vi.mock('virtual:pwa-register', () => ({ registerSW: () => async () => {} }));

import { App } from '../../src/App.tsx';
import { db } from '../../src/db/database.ts';

const DAY = 24 * 3_600_000;

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await db.delete();
  await db.open();
});

const button = (name: RegExp | string) => screen.getByRole('button', { name });

/** Opens the app and starts the suggested session (Pierna A on a fresh install). */
async function startFirstSession() {
  render(<App />);
  await screen.findByText('¿Qué toca hoy?');
  fireEvent.click(button(/Empezar sesión/));
  await screen.findByText('Hip thrust');
}

/** Types a load in the focused set row, like with the iOS keypad. */
function typeWeight(value: string) {
  const input = screen.getByLabelText('peso');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

async function completeFocusedSet(rpeLabel: RegExp) {
  fireEvent.click(button('Hecho'));
  await screen.findByText('¿Cuántas te quedaban?');
  fireEvent.click(button(rpeLabel));
}

describe('a full session, from the home screen to the history', () => {
  it('start → log a set with RPE → rest timer → summary → finish → rotation and history', async () => {
    await startFirstSession();

    // First time: no load suggested, a calibration hint instead.
    expect(await screen.findByText('Primera vez: elige un peso con el que llegues a 8 reps cerca del fallo.')).toBeTruthy();
    expect((screen.getByLabelText('peso') as HTMLInputElement).value).toBe('');

    typeWeight('40');
    await completeFocusedSet(/Me quedaban 2$/);

    // The set is saved with its RPE, the rest timer runs and announces the next set.
    await screen.findByText('RPE 8');
    const timer = await screen.findByRole('timer');
    expect(within(timer).getByText('Descanso')).toBeTruthy();
    expect(within(timer).getByText(/Hip thrust · serie 2: 40 kg × 8/)).toBeTruthy();
    // The load she chose is carried to the next set.
    await waitFor(() => expect((screen.getByLabelText('peso') as HTMLInputElement).value).toBe('40'));

    fireEvent.click(button('Terminar sesión'));
    await screen.findByText('¡Buen trabajo!');
    expect(screen.getByText(/Quedan 11 series sin hacer/)).toBeTruthy();
    fireEvent.click(button('Terminar'));

    // Back home: the rotation moved on, the backup reminder appears, the session is in the history.
    await screen.findByText('¿Qué toca hoy?');
    expect(within(button(/Empezar sesión/)).getByText('Tren superior A')).toBeTruthy();
    expect(screen.getByText('Haz una copia de seguridad')).toBeTruthy();

    fireEvent.click(button('Historial'));
    await screen.findByText('Historial y progreso');
    expect(await screen.findByText(/1 series · 320 kg/)).toBeTruthy();
  });

  it('resumes the session exactly where it was after the app is closed', async () => {
    await startFirstSession();
    typeWeight('42,5');
    await completeFocusedSet(/Me quedaba 1$/);
    await screen.findByText('RPE 9');

    cleanup(); // the app is killed…
    render(<App />); // …and opened again: straight back into the workout.
    await screen.findByText('Hip thrust');
    expect(screen.getByText('RPE 9')).toBeTruthy();
    expect(screen.getAllByText('42,5 kg × 8').length).toBeGreaterThan(0); // the completed set
    expect(await screen.findByRole('timer')).toBeTruthy();
  });

  it('a session without any set is discarded and the rotation does not move', async () => {
    await startFirstSession();
    fireEvent.click(button('Terminar sesión'));
    await screen.findByText(/No has terminado ninguna serie/);
    fireEvent.click(button('Descartar sesión'));

    await screen.findByText('¿Qué toca hoy?');
    expect(within(button(/Empezar sesión/)).getByText('Pierna A')).toBeTruthy();
    expect(await db.workouts.where('status').equals('done').count()).toBe(0);
  });
});

describe('− / + buttons', () => {
  it('a tap changes the value by one step; touching then scrolling changes nothing', async () => {
    await startFirstSession();
    const reps = () => (screen.getByLabelText('repeticiones') as HTMLInputElement).value;
    expect(reps()).toBe('8');

    // Wait for the screen (and the saved value) rather than reading it at the same instant:
    // the CI machine is slower, and the value must hold once the database answers.
    fireEvent.click(button('Más repeticiones'));
    await waitFor(() => expect(reps()).toBe('9'));
    fireEvent.click(button('Menos repeticiones'));
    fireEvent.click(button('Menos repeticiones'));
    await waitFor(() => expect(reps()).toBe('7'));
    // …and is saved.
    await waitFor(async () => {
      // The Hip thrust row precisely: the other exercises have a first set too (in random id order).
      const hipThrust = await db.performedExercises.where('exerciseId').equals('hip-thrust').first();
      const set = (await db.sets.where('performedExerciseId').equals(hipThrust?.id ?? '').toArray()).find(
        (s) => !s.isWarmup && s.index === 0,
      );
      expect(set?.reps).toBe(7);
    });

    // Finger lands on "+" and the page starts scrolling: the browser cancels the pointer.
    fireEvent.pointerDown(button('Más repeticiones'));
    fireEvent.pointerCancel(button('Más repeticiones'));
    await new Promise((r) => setTimeout(r, 600)); // longer than the hold delay
    expect(reps()).toBe('7');
  });

  it('refuses 0 typed with the keypad', async () => {
    await startFirstSession();
    const input = screen.getByLabelText('repeticiones') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(input.value).toBe('8');
  });
});

describe('home screen dates', () => {
  it('are refreshed when the app comes back to the foreground days later', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 10, 18, 0) });
    await startFirstSession();
    typeWeight('40');
    await completeFocusedSet(/Me quedaban 2$/);
    await screen.findByText('RPE 8');
    fireEvent.click(button('Terminar sesión'));
    await screen.findByText('¡Buen trabajo!');
    fireEvent.click(button('Terminar'));
    await screen.findByText('¿Qué toca hoy?');
    expect(await screen.findByText('hoy')).toBeTruthy();
    expect(screen.getByText(/Últimos 7 días · 1 sesión/)).toBeTruthy();

    // The phone is put away; the app stays in memory and is reopened 3 days later.
    vi.setSystemTime(new Date(2026, 10, 10, 18, 0).getTime() + 3 * DAY);
    fireEvent(document, new Event('visibilitychange'));
    expect(await screen.findByText('hace 3 días')).toBeTruthy();

    // …and 9 days later the session has left the 7-day summary.
    vi.setSystemTime(new Date(2026, 10, 10, 18, 0).getTime() + 9 * DAY);
    fireEvent(document, new Event('visibilitychange'));
    expect(await screen.findByText(/Últimos 7 días · 0 sesiones/)).toBeTruthy();
  });
});
