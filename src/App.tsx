import { useEffect, useState } from 'react';
import { db } from './db/database.ts';
import type { HomeData } from './db/home.ts';
import { requestPersistentStorage } from './db/persist.ts';
import type { SessionTemplate } from './db/types.ts';
import { abandonWorkout, getActiveWorkout, startWorkout } from './db/workouts.ts';
import { daysSince, legDayWarning, returnFromBreak } from './engine/index.ts';
import { HomeScreen } from './features/home/HomeScreen.tsx';
import { ExerciseProgressScreen } from './features/history/ExerciseProgressScreen.tsx';
import { HistoryScreen, type HistoryTab } from './features/history/HistoryScreen.tsx';
import { ProgramScreen } from './features/settings/ProgramScreen.tsx';
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
  | { name: 'history'; tab: HistoryTab }
  | { name: 'exerciseProgress'; exerciseId: string; tab: HistoryTab }
  | { name: 'settings' }
  | { name: 'program'; templateId: string }
  | { name: 'historyDetail'; workoutId: string; tab: HistoryTab };

/** Confirmation needed before starting a session. */
type StartCheck =
  | { kind: 'active'; template: SessionTemplate; activeId: string }
  | { kind: 'legs'; template: SessionTemplate; message: string; data: HomeData }
  | { kind: 'break'; template: SessionTemplate; days: number }
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

  const begin = async (template: SessionTemplate, reduceLoads = false) => {
    setCheck(null);
    const workoutId = await startWorkout(db, template.id, Date.now(), { reduceLoads });
    setScreen({ name: 'workout', workoutId });
  };

  /** Last check before starting (§7.6): back after 10+ days → offer −10 % on this session type. */
  const checkBreakThenBegin = (template: SessionTemplate, data: HomeData) => {
    const now = Date.now();
    if (data.deloadRemaining === 0 && returnFromBreak(data.sessionStarts, data.lastStartByTemplate[template.id] ?? null, now)) {
      setCheck({ kind: 'break', template, days: daysSince(Math.max(...data.sessionStarts), now) });
      return;
    }
    void begin(template);
  };

  const requestStart = (template: SessionTemplate, data: HomeData) => {
    unlockAudio(); // inside the "Empezar sesión" tap: iOS allows audio from now on
    if (data.activeWorkout) {
      setCheck({ kind: 'active', template, activeId: data.activeWorkout.id });
      return;
    }
    const warning = legDayWarning(template.isLegDay, data.lastLegSessionAt, Date.now());
    if (warning) {
      setCheck({ kind: 'legs', template, message: warning, data });
      return;
    }
    checkBreakThenBegin(template, data);
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
          tab={screen.tab}
          onTab={(tab) => setScreen({ name: 'history', tab })}
          onBack={() => setScreen({ name: 'home' })}
          onOpen={(workoutId) => setScreen({ name: 'historyDetail', workoutId, tab: screen.tab })}
          onOpenExercise={(exerciseId) => setScreen({ name: 'exerciseProgress', exerciseId, tab: screen.tab })}
        />
      )}
      {screen.name === 'historyDetail' && (
        <WorkoutDetailScreen workoutId={screen.workoutId} onBack={() => setScreen({ name: 'history', tab: screen.tab })} />
      )}
      {screen.name === 'exerciseProgress' && (
        <ExerciseProgressScreen exerciseId={screen.exerciseId} onBack={() => setScreen({ name: 'history', tab: screen.tab })} />
      )}
      {screen.name === 'settings' && (
        <SettingsScreen onBack={() => setScreen({ name: 'home' })} onOpenProgram={(templateId) => setScreen({ name: 'program', templateId })} />
      )}
      {screen.name === 'program' && <ProgramScreen templateId={screen.templateId} onBack={() => setScreen({ name: 'settings' })} />}
      {screen.name === 'home' && (
        <HomeScreen
          onStart={requestStart}
          onResume={(workoutId) => setScreen({ name: 'workout', workoutId })}
          onHistory={() => setScreen({ name: 'history', tab: 'sessions' })}
          onSettings={() => setScreen({ name: 'settings' })}
        />
      )}

      <ConfirmSheet
        open={check?.kind === 'legs'}
        title="¿Piernas otra vez?"
        message={check?.kind === 'legs' ? check.message : undefined}
        confirmLabel="Empezar igualmente"
        onConfirm={() => check?.kind === 'legs' && checkBreakThenBegin(check.template, check.data)}
        onCancel={() => setCheck(null)}
      />

      <Sheet open={check?.kind === 'break'} onClose={() => setCheck(null)} title="¡Bienvenida de vuelta!">
        {check?.kind === 'break' && (
          <>
            <p className={ui.sheetText}>
              Llevabas {check.days} días sin entrenar. ¿Bajamos un 10 % las cargas de hoy para retomar con calma?
            </p>
            <div className={ui.sheetActions}>
              <button type="button" className={ui.primaryButton} onClick={() => void begin(check.template, true)}>
                Sí, −10 % hoy
              </button>
              <button type="button" className={ui.secondaryButton} onClick={() => void begin(check.template, false)}>
                No, cargas normales
              </button>
            </div>
          </>
        )}
      </Sheet>

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
