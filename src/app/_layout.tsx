import { useEffect, useRef } from 'react';
import { Appearance, AppState } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { migrateDb } from '../db/migrations';
import { useDb } from '../db/useDb';
import { getMeta, META_KEYS } from '../db/repos/meta';
import {
  resolveThemeName,
  useUiStore,
  type AlarmSoundId,
  type ClockFormat,
  type HapticIntensity,
  type ThemeMode,
  type WeekStart,
} from '../state/ui';
import { dark, light } from '../theme/tokens';
import { localDateString } from '../db/time';
import { setDb } from '../state/tasks';
import { ensureInstancesForDate, markPastDueMissed } from '../tasks/recurrence';
import {
  setNotificationsDb,
  setupNotifications,
  rescheduleAllAlarms,
  processMissedAlarms,
} from '../notifications';
import { reconcileTimers } from '../timers';
import { configureHaptics } from '../haptics';
import { UpdateBanner } from '../updates/UpdateBanner';
import { updaterActions } from '../updates/updaterStore';

/**
 * Startup data tasks. Every step is individually guarded so a failure
 * in one (e.g. denied notification permission) can never break boot.
 * Runs on cold start and on every foreground (covers midnight rollover,
 * timezone changes, and alarm ledger reconciliation).
 */
async function runStartupTasks(db: SQLiteDatabase): Promise<void> {
  const today = localDateString();
  try {
    await markPastDueMissed(db, today);
  } catch (e) {
    console.error('[bootstrap] auto-miss failed', e);
  }
  try {
    await ensureInstancesForDate(db, today);
  } catch (e) {
    console.error('[bootstrap] instance generation failed', e);
  }
  try {
    await setupNotifications();
  } catch (e) {
    console.error('[bootstrap] notification setup failed', e);
  }
  try {
    await rescheduleAllAlarms(db);
  } catch (e) {
    console.error('[bootstrap] alarm reschedule failed', e);
  }
  try {
    await processMissedAlarms(db, new Date());
  } catch (e) {
    console.error('[bootstrap] missed sweep failed', e);
  }
  try {
    await reconcileTimers(db);
  } catch (e) {
    console.error('[bootstrap] timer reconcile failed', e);
  }
}

function Bootstrap({ children }: { children: React.ReactNode }) {
  const db = useDb();
  const segments = useSegments();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    // Module-level DB handles for stores/listeners that live outside React.
    setDb(db);
    setNotificationsDb(db);

    (async () => {
      const [
        onboarded,
        themeRaw,
        hapticsEnabled,
        hapticIntensity,
        graceMin,
        snoozeMin,
        clockFormat,
        weekStart,
        alarmSound,
      ] = await Promise.all([
        getMeta(db, META_KEYS.onboarded),
        getMeta(db, META_KEYS.theme),
        getMeta(db, META_KEYS.hapticsEnabled),
        getMeta(db, META_KEYS.hapticIntensity),
        getMeta(db, META_KEYS.graceMin),
        getMeta(db, META_KEYS.snoozeMin),
        getMeta(db, 'clock_format'),
        getMeta(db, 'week_start'),
        getMeta(db, 'alarm_sound'),
      ]);

      const themeMode: ThemeMode =
        themeRaw === 'light' || themeRaw === 'system' ? themeRaw : 'dark';

      const ui = {
        themeMode,
        theme: resolveThemeName(themeMode),
        hapticsEnabled: hapticsEnabled !== '0',
        hapticIntensity: (
          ['light', 'medium', 'strong'] as HapticIntensity[]
        ).includes(hapticIntensity as HapticIntensity)
          ? (hapticIntensity as HapticIntensity)
          : ('medium' as HapticIntensity),
        graceMin:
          Number.isFinite(Number(graceMin)) && Number(graceMin) > 0 ? Number(graceMin) : 15,
        snoozeMin:
          Number.isFinite(Number(snoozeMin)) && Number(snoozeMin) > 0 ? Number(snoozeMin) : 9,
        clockFormat: (clockFormat === '12h' ? '12h' : '24h') as ClockFormat,
        weekStart: (weekStart === 'sun' ? 'sun' : 'mon') as WeekStart,
        alarmSound: (
          ['pulse', 'beacon', 'chime', 'industrial'] as AlarmSoundId[]
        ).includes(alarmSound as AlarmSoundId)
          ? (alarmSound as AlarmSoundId)
          : ('pulse' as AlarmSoundId),
        hydrated: true,
      };
      useUiStore.getState().set(ui);
      configureHaptics({ enabled: ui.hapticsEnabled, intensity: ui.hapticIntensity });

      if (onboarded === '1') {
        await runStartupTasks(db);
      }

      // In-app update check (Android, throttled to once per 6h internally).
      void updaterActions.runCheck();

      const onOnboarding = (segments as unknown as string[]).includes('onboarding');
      if (onboarded !== '1' && !onOnboarding) {
        router.replace('/onboarding');
      }
    })();

    const appearanceSub = Appearance.addChangeListener(({ colorScheme }) => {
      const currentMode = useUiStore.getState().themeMode;
      if (currentMode === 'system') {
        useUiStore.getState().set({
          theme: colorScheme === 'light' ? 'light' : 'dark',
        });
      }
    });

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void runStartupTasks(db);
        void updaterActions.runCheck();
        void updaterActions.retryInstall();
      }
    });

    // Boot receiver posts checkoff://restore-alarms ("tap to restore alarms").
    const onUrl = (url: string) => {
      if (url.startsWith('checkoff://restore-alarms')) {
        void (async () => {
          try {
            await rescheduleAllAlarms(db);
            await processMissedAlarms(db, new Date());
          } catch (e) {
            console.error('[bootstrap] restore-alarms failed', e);
          }
        })();
      }
    };
    const linkSub = Linking.addEventListener('url', ({ url }) => onUrl(url));
    void Linking.getInitialURL()
      .then((url) => {
        if (url) onUrl(url);
      })
      .catch(() => {});

    return () => {
      appearanceSub.remove();
      appStateSub.remove();
      linkSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <UpdateBanner />
      {children}
    </>
  );
}

export default function RootLayout() {
  const themeName = useUiStore((s) => s.theme);
  const palette = themeName === 'light' ? light : dark;

  return (
    <SQLiteProvider databaseName="checkoff.db" onInit={migrateDb}>
      <StatusBar style={themeName === 'light' ? 'dark' : 'light'} />
      <Bootstrap>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.bg },
            animation: 'fade',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="add-task" options={{ presentation: 'modal' }} />
          <Stack.Screen name="timer" />
          <Stack.Screen name="day/[date]" />
        </Stack>
      </Bootstrap>
    </SQLiteProvider>
  );
}
