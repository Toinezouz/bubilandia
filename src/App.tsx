import { useEffect, useState } from 'react';
import { db } from './db/database.ts';
import type { HomeData } from './db/home.ts';
import { requestPersistentStorage } from './db/persist.ts';
import type { SessionTemplate } from './db/types.ts';
import { abandonWorkout, getActiveWorkout, startWorkout } from './db/workouts.ts';
import { legDayWarning } from './engine/index.ts';
import { HomeScreen } from './features/home/HomeScreen.tsx';
import { HistoryScreen } from './features/history/HistoryScreen.tsx';
import { SettingsScreen } from './features/settings/SettingsScreen.tsx';
import { WorkoutDetailScreen } from './features/history/WorkoutDetailScreen.tsx';
import { SummaryScreen } from './features/workout/SummaryScreen.tsx';
import { WorkoutScreen } from './features/workout/WorkoutScreen.tsx';
import { seedIfEmpty } from './seed/seed.ts';
import { ConfirmSheet, Sheet } from './shared/components/Sheet.tsx';
import ui from './shared/components/components.module.css';
import { unlockAudio } from './shared/sound.ts';
import { InstallScreen } from './features/install/InstallScreen.tsx';
import { isIos, isIosOtherBrowser, isStandalone, shouldShowInstallHelp, type NavigatorLike } from './shared/platform.ts';

const INSTALL_DISMISSED_KEY = 'install-help-dismissed';

/** Install help (§3): iOS in a browser tab, or forced with ?instalar. Decided once per load. */
function initialInstallHelp(): boolean {
  let dismissed = false;
  try {
    dismissed = sessionStorage.getItem(INSTALL_DISMISSED_KEY) === '1';
  } catch {
    // Storage unavailable: just show the page again.
  }
  return shouldShowInstallHelp({
    standalone: isStandalone(navigator as Navigator & NavigatorLike, window.matchMedia.bind(window)),
    ios: isIos(navigator.userAgent, navigator.maxTouchPoints),
    forced: new URLSearchParams(location.search).has('instalar'),
    dismissedThisVisit: dismissed,
  });
}

type Screen =
  | { name: 'loading' }
  | { name: 'error'; message: string }
  | { name: 'home' }
  | { name: 'workout'; workoutId: string }
  | { name: 'summary'; workoutId: string }
  | { name: 'history' }
  | { name: 'settings' }
  | { name: 'historyDetail'; workoutId: string };

/** Confirmation needed before starting a session. */
type StartCheck =
  | { kind: 'active'; template: SessionTemplate; activeId: string }
  | { kind: 'legs'; template: SessionTemplate; message: string }
  | null;

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'loading' });
  const [check, setCheck] = useState<StartCheck>(null);
  const [installHelp, setInstallHelp] = useState(initialInstallHelp);

  // Boot: load the program on first launch, then resume an unfinished workout directly.
  useEffect(() => {
    (async () => {
      await seedIfEmpty(db);
      void requestPersistentStorage();
      const active = await getActiveWorkout(db);
      setScreen(active ? { name: 'workout', workoutId: active.id } : { name: 'home' });
    })().catch((error: unknown) => setScreen({ name: 'error', message: String(error) }));
  }, []);

  const begin = async (template: SessionTemplate) => {
    setCheck(null);
    const workoutId = await startWorkout(db, template.id, Date.now());
    setScreen({ name: 'workout', workoutId });
  };

  const requestStart = (template: SessionTemplate, data: HomeData) => {
    unlockAudio(); // inside the "Empezar sesión" tap: iOS allows audio from now on
    if (data.activeWorkout) {
      setCheck({ kind: 'active', template, activeId: data.activeWorkout.id });
      return;
    }
    const warning = legDayWarning(template.isLegDay, data.lastLegSessionAt, Date.now());
    if (warning) {
      setCheck({ kind: 'legs', template, message: warning });
      return;
    }
    void begin(template);
  };

  if (installHelp) {
    return (
      <InstallScreen
        otherBrowser={isIosOtherBrowser(navigator.userAgent)}
        onContinueInBrowser={() => {
          try {
            sessionStorage.setItem(INSTALL_DISMISSED_KEY, '1');
          } catch {
            // ignore
          }
          setInstallHelp(false);
        }}
      />
    );
  }
  if (screen.name === 'loading') return null;
  if (screen.name === 'error') {
    return (
      <main style={{ padding: 16 }}>
        <p role="alert">No se pudieron cargar los datos: {screen.message}</p>
      </main>
    );
  }

  return (
    <>
      {screen.name === 'workout' && (
        <WorkoutScreen
          workoutId={screen.workoutId}
          onExit={() => setScreen({ name: 'home' })}
          onFinish={() => setScreen({ name: 'summary', workoutId: screen.workoutId })}
        />
      )}
      {screen.name === 'summary' && (
        <SummaryScreen
          workoutId={screen.workoutId}
          onBack={() => setScreen({ name: 'workout', workoutId: screen.workoutId })}
          onFinished={() => setScreen({ name: 'home' })}
        />
      )}
      {screen.name === 'history' && (
        <HistoryScreen
          onBack={() => setScreen({ name: 'home' })}
          onOpen={(workoutId) => setScreen({ name: 'historyDetail', workoutId })}
        />
      )}
      {screen.name === 'historyDetail' && (
        <WorkoutDetailScreen workoutId={screen.workoutId} onBack={() => setScreen({ name: 'history' })} />
      )}
      {screen.name === 'settings' && <SettingsScreen onBack={() => setScreen({ name: 'home' })} />}
      {screen.name === 'home' && (
        <HomeScreen
          onStart={requestStart}
          onResume={(workoutId) => setScreen({ name: 'workout', workoutId })}
          onHistory={() => setScreen({ name: 'history' })}
          onSettings={() => setScreen({ name: 'settings' })}
        />
      )}

      <ConfirmSheet
        open={check?.kind === 'legs'}
        title="¿Piernas otra vez?"
        message={check?.kind === 'legs' ? check.message : undefined}
        confirmLabel="Empezar igualmente"
        onConfirm={() => check && void begin(check.template)}
        onCancel={() => setCheck(null)}
      />

      <Sheet open={check?.kind === 'active'} onClose={() => setCheck(null)} title="Ya tienes una sesión en curso">
        {check?.kind === 'active' && (
          <div className={ui.sheetActions}>
            <button
              type="button"
              className={ui.primaryButton}
              onClick={() => {
                setCheck(null);
                setScreen({ name: 'workout', workoutId: check.activeId });
              }}
            >
              Continuar la sesión en curso
            </button>
            <button
              type="button"
              className={ui.dangerButton}
              onClick={() => void abandonWorkout(db, check.activeId, Date.now()).then(() => begin(check.template))}
            >
              Abandonarla y empezar {check.template.name}
            </button>
            <button type="button" className={ui.secondaryButton} onClick={() => setCheck(null)}>
              Cancelar
            </button>
          </div>
        )}
      </Sheet>
    </>
  );
}
