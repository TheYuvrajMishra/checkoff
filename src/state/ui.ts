import { create } from 'zustand';

/**
 * UI-only state. STABLE — coordinator-owned, do not edit.
 * DB is the source of truth; this store mirrors settings for fast UI reads.
 * Bootstrap (app _layout) hydrates it from the meta table.
 */

export type HapticIntensity = 'light' | 'medium' | 'strong';
export type ThemeName = 'dark' | 'light';

interface UiState {
  theme: ThemeName;
  hapticsEnabled: boolean;
  hapticIntensity: HapticIntensity;
  graceMin: number;
  snoozeMin: number;
  hydrated: boolean;
  set: (p: Partial<UiState>) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  theme: 'dark',
  hapticsEnabled: true,
  hapticIntensity: 'medium',
  graceMin: 15,
  snoozeMin: 9,
  hydrated: false,
  set: (p) => set(p),
}));
