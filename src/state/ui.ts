import { Appearance } from 'react-native';
import { create } from 'zustand';

/**
 * UI-only state.
 * DB is the source of truth; this store mirrors settings for fast UI reads.
 * Bootstrap (app _layout) hydrates it from the meta table.
 */

export type HapticIntensity = 'light' | 'medium' | 'strong';
export type ThemeName = 'dark' | 'light';
export type ThemeMode = 'dark' | 'light' | 'system';
export type ClockFormat = '12h' | '24h';
export type WeekStart = 'mon' | 'sun';
export type AlarmSoundId = 'pulse' | 'beacon' | 'chime' | 'industrial';

export function resolveThemeName(mode: ThemeMode): ThemeName {
  if (mode === 'system') {
    return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
  }
  return mode;
}

interface UiState {
  theme: ThemeName;
  themeMode: ThemeMode;
  hapticsEnabled: boolean;
  hapticIntensity: HapticIntensity;
  graceMin: number;
  snoozeMin: number;
  clockFormat: ClockFormat;
  weekStart: WeekStart;
  alarmSound: AlarmSoundId;
  hydrated: boolean;
  set: (p: Partial<UiState>) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setHapticIntensity: (intensity: HapticIntensity | 'heavy') => void;
  setClockFormat: (format: ClockFormat) => void;
  setWeekStart: (start: WeekStart) => void;
  setGraceMin: (min: number) => void;
  setSnoozeMin: (min: number) => void;
  setAlarmSound: (sound: AlarmSoundId) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  theme: 'dark',
  themeMode: 'dark',
  hapticsEnabled: true,
  hapticIntensity: 'medium',
  graceMin: 15,
  snoozeMin: 9,
  clockFormat: '24h',
  weekStart: 'mon',
  alarmSound: 'pulse',
  hydrated: false,
  set: (p) =>
    set((prev) => {
      const next = { ...prev, ...p };
      if (p.themeMode && !p.theme) {
        next.theme = resolveThemeName(p.themeMode);
      }
      return next;
    }),
  setThemeMode: (themeMode) =>
    set((prev) => ({
      ...prev,
      themeMode,
      theme: resolveThemeName(themeMode),
    })),
  setHapticsEnabled: (hapticsEnabled) =>
    set((prev) => ({ ...prev, hapticsEnabled })),
  setHapticIntensity: (intensity) =>
    set((prev) => ({
      ...prev,
      hapticIntensity: intensity === 'heavy' ? 'strong' : (intensity as HapticIntensity),
    })),
  setClockFormat: (clockFormat) =>
    set((prev) => ({ ...prev, clockFormat })),
  setWeekStart: (weekStart) =>
    set((prev) => ({ ...prev, weekStart })),
  setGraceMin: (graceMin) =>
    set((prev) => ({ ...prev, graceMin })),
  setSnoozeMin: (snoozeMin) =>
    set((prev) => ({ ...prev, snoozeMin })),
  setAlarmSound: (alarmSound) =>
    set((prev) => ({ ...prev, alarmSound })),
}));

