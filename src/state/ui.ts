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
  // Reward notification prefs (mirrored from meta table for fast UI reads).
  rewardStreakAlerts: boolean;
  rewardDailyNudge: boolean;
  /** 'HH:MM' local time */
  rewardNudgeTime: string;
  rewardAffordableAlerts: boolean;
  rewardLevelUp: boolean;
  rewardWeeklyReview: boolean;
  /** 'HH:MM' local time */
  rewardQuietStart: string;
  /** 'HH:MM' local time */
  rewardQuietEnd: string;
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
  setRewardNotif: (p: Partial<RewardNotifPrefs>) => void;
}

export interface RewardNotifPrefs {
  streakAlerts: boolean;
  dailyNudge: boolean;
  nudgeTime: string;
  affordableAlerts: boolean;
  levelUp: boolean;
  weeklyReview: boolean;
  quietStart: string;
  quietEnd: string;
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
  rewardStreakAlerts: true,
  rewardDailyNudge: true,
  rewardNudgeTime: '20:00',
  rewardAffordableAlerts: true,
  rewardLevelUp: true,
  rewardWeeklyReview: true,
  rewardQuietStart: '22:00',
  rewardQuietEnd: '07:00',
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
  setRewardNotif: (p) =>
    set((prev) => ({
      ...prev,
      ...(p.streakAlerts !== undefined && { rewardStreakAlerts: p.streakAlerts }),
      ...(p.dailyNudge !== undefined && { rewardDailyNudge: p.dailyNudge }),
      ...(p.nudgeTime !== undefined && { rewardNudgeTime: p.nudgeTime }),
      ...(p.affordableAlerts !== undefined && { rewardAffordableAlerts: p.affordableAlerts }),
      ...(p.levelUp !== undefined && { rewardLevelUp: p.levelUp }),
      ...(p.weeklyReview !== undefined && { rewardWeeklyReview: p.weeklyReview }),
      ...(p.quietStart !== undefined && { rewardQuietStart: p.quietStart }),
      ...(p.quietEnd !== undefined && { rewardQuietEnd: p.quietEnd }),
    })),
}));

