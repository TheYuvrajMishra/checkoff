import { useUiStore } from '../state/ui';

/**
 * CheckOff design tokens — Strict Monotone & Chrome Instrument Edition.
 * True black base (#000000), graded monochrome surfaces, hairline borders
 * (8–12% opacity), silver/chrome metallic highlights, zero colored accents.
 * Light theme is a true high-contrast monochrome inverse.
 * 8pt grid, 16–24pt radii, 48dp minimum touch target.
 */

export type ThemeName = 'dark' | 'light';
export type Priority = 'low' | 'medium' | 'high';

export interface ThemePalette {
  name: ThemeName;
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  borderStrong: string;
  topHighlight: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentDim: string;
  onAccent: string;
  danger: string;
  warn: string;
  success: string;
  /** 4-stop silver/chrome linear gradient stops for metallic text & primary controls */
  metallic: [string, string, string, string];
  /** Subtle surface sheen gradient stops for primary buttons */
  buttonSheen: [string, string, string];
  backdrop: string;

  // Phase 5 & 6 semantic aliases
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;
  bgSurface: string;
  bgElevated: string;
  borderSubtle: string;
  priority: Record<Priority, string>;
}

export const dark: ThemePalette = {
  name: 'dark',
  bg: '#000000',
  surface: '#0A0A0A',
  surface2: '#111111',
  surface3: '#1A1A1A',
  border: 'rgba(255, 255, 255, 0.10)',
  borderStrong: 'rgba(255, 255, 255, 0.22)',
  topHighlight: 'rgba(255, 255, 255, 0.09)',
  text: '#FFFFFF',
  textDim: '#A3A3A3',
  textFaint: '#5C5C5C',
  accent: '#FFFFFF',
  accentDim: 'rgba(255, 255, 255, 0.10)',
  onAccent: '#000000',
  danger: '#D4D4D4',
  warn: '#9E9E9E',
  success: '#FFFFFF',
  metallic: ['#FFFFFF', '#E5E5E5', '#8C8C8C', '#F5F5F5'],
  buttonSheen: ['#FFFFFF', '#E8E8E8', '#D4D4D4'],
  backdrop: 'rgba(0, 0, 0, 0.78)',

  textPrimary: '#FFFFFF',
  textSecondary: '#A3A3A3',
  textMuted: '#5C5C5C',
  textInverse: '#000000',
  bgSurface: '#0A0A0A',
  bgElevated: '#111111',
  borderSubtle: 'rgba(255, 255, 255, 0.10)',
  priority: {
    high: '#FFFFFF',
    medium: '#A3A3A3',
    low: '#5C5C5C',
  },
};

export const light: ThemePalette = {
  name: 'light',
  bg: '#FFFFFF',
  surface: '#F7F7F7',
  surface2: '#EFEFEF',
  surface3: '#E4E4E4',
  border: 'rgba(0, 0, 0, 0.10)',
  borderStrong: 'rgba(0, 0, 0, 0.24)',
  topHighlight: 'rgba(255, 255, 255, 0.90)',
  text: '#000000',
  textDim: '#525252',
  textFaint: '#8A8A8A',
  accent: '#000000',
  accentDim: 'rgba(0, 0, 0, 0.08)',
  onAccent: '#FFFFFF',
  danger: '#262626',
  warn: '#525252',
  success: '#000000',
  metallic: ['#000000', '#3B3B3B', '#737373', '#141414'],
  buttonSheen: ['#1F1F1F', '#0A0A0A', '#000000'],
  backdrop: 'rgba(0, 0, 0, 0.48)',

  textPrimary: '#000000',
  textSecondary: '#525252',
  textMuted: '#8A8A8A',
  textInverse: '#FFFFFF',
  bgSurface: '#F7F7F7',
  bgElevated: '#EFEFEF',
  borderSubtle: 'rgba(0, 0, 0, 0.10)',
  priority: {
    high: '#000000',
    medium: '#525252',
    low: '#8A8A8A',
  },
};

export function useTheme(): ThemePalette {
  return useUiStore((s) => (s.theme === 'light' ? light : dark));
}

export const CATEGORY_TOKENS = ['slate', 'amber', 'teal', 'violet', 'rose', 'sage'] as const;
export type CategoryToken = (typeof CATEGORY_TOKENS)[number];

export const categoryColors: Record<CategoryToken, string> = {
  slate: '#FFFFFF',
  amber: '#D9D9D9',
  teal: '#B8B8B8',
  violet: '#969696',
  rose: '#787878',
  sage: '#5E5E5E',
};

export const categoryColorsLight: Record<CategoryToken, string> = {
  slate: '#000000',
  amber: '#262626',
  teal: '#454545',
  violet: '#666666',
  rose: '#858585',
  sage: '#A3A3A3',
};

/**
 * Handles all call signatures:
 * - categoryColor(token, themeName)
 * - categoryColor(token, themePalette)
 * - categoryColor(themePalette, token)
 */
export function categoryColor(
  first: string | ThemePalette,
  second?: ThemeName | ThemePalette | string
): string {
  let token = 'slate';
  let isLight = false;

  if (typeof first === 'object' && first !== null) {
    isLight = first.name === 'light';
    if (typeof second === 'string') token = second;
  } else {
    if (typeof first === 'string') token = first;
    if (typeof second === 'object' && second !== null) {
      isLight = second.name === 'light';
    } else if (second === 'light') {
      isLight = true;
    }
  }

  const map = isLight ? categoryColorsLight : categoryColors;
  return (map as Record<string, string>)[token] ?? map.slate;
}

export function priorityRuleColor(
  priority: 'low' | 'medium' | 'high',
  theme: ThemePalette
): string {
  if (priority === 'high') return theme.text;
  if (priority === 'medium') return theme.textDim;
  return theme.textFaint;
}

export interface TextStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700' | '800';
  fontFamily?: string;
  letterSpacing?: number;
}

export const MONO = 'monospace';

export const type = {
  hero: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.6 } as TextStyle,
  display: { fontSize: 36, lineHeight: 42, fontWeight: '700', letterSpacing: -0.8 } as TextStyle,
  h1: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.5 } as TextStyle,
  h2: { fontSize: 18, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2 } as TextStyle,
  h3: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: -0.1 } as TextStyle,
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' } as TextStyle,
  bodyMedium: { fontSize: 15, lineHeight: 22, fontWeight: '500' } as TextStyle,
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' } as TextStyle,
  bodySm: { fontSize: 13, lineHeight: 18, fontWeight: '400' } as TextStyle,
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' } as TextStyle,
  caption: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 1.0 } as TextStyle,
  label: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 1.0 } as TextStyle,
  mono: { fontSize: 13, lineHeight: 18, fontWeight: '500', fontFamily: MONO } as TextStyle,
  monoSm: { fontSize: 11, lineHeight: 15, fontWeight: '500', fontFamily: MONO } as TextStyle,
  monoSmall: { fontSize: 11, lineHeight: 15, fontWeight: '600', fontFamily: MONO } as TextStyle,
  monoLg: { fontSize: 18, lineHeight: 24, fontWeight: '700', fontFamily: MONO } as TextStyle,
  clock: { fontSize: 54, lineHeight: 60, fontWeight: '700', fontFamily: MONO, letterSpacing: -1.5 } as TextStyle,
  statBig: { fontSize: 32, lineHeight: 38, fontWeight: '700', fontFamily: MONO, letterSpacing: -0.8 } as TextStyle,
};

export const MOTION = {
  fast: 150,
  normal: 180,
  slow: 240,
} as const;

export const motion = MOTION;

/** 16 to 24pt primary surface radii on an 8pt system */
export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999,
};

/**
 * 8pt grid.
 * Callable as space(2) -> 16, and accessible as space.xs, space.sm, space.md, space.base, etc.
 */
interface SpaceFn {
  (n: number): number;
  xs: number;
  sm: number;
  md: number;
  base: number;
  lg: number;
  xl: number;
  '2xl': number;
  '3xl': number;
}

const spaceCalculator = ((n: number): number => n * 8) as SpaceFn;
spaceCalculator.xs = 4;
spaceCalculator.sm = 8;
spaceCalculator.md = 12;
spaceCalculator.base = 16;
spaceCalculator.lg = 20;
spaceCalculator.xl = 24;
spaceCalculator['2xl'] = 32;
spaceCalculator['3xl'] = 48;

export const space: SpaceFn = spaceCalculator;

/** Minimum tap target (48dp). */
export const TAP = 48;

export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const hitSlop8 = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const hitSlop12 = { top: 12, bottom: 12, left: 12, right: 12 } as const;

export const shadow = {
  sm: {
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  md: {
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.34,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  lg: {
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
};
