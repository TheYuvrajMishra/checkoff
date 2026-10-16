/**
 * CheckOff design tokens. Phase 3 reskin (2026-10-16).
 * Dark-first. Near-black base, layered surfaces. One sharp accent.
 * Desaturated category palette. 8pt grid. 16-20pt radii.
 * No emoji anywhere in the UI. Tone: serious instrument.
 */

export type ThemeName = 'dark' | 'light';

export interface ThemePalette {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentDim: string;
  onAccent: string;
  danger: string;
  warn: string;
  success: string;
}

export const dark: ThemePalette = {
  bg: '#0A0A0B',
  surface: '#131316',
  surface2: '#1C1C21',
  border: '#26262C',
  text: '#F5F5F4',
  textDim: '#A1A1AA',
  textFaint: '#63636B',
  accent: '#E8B93E',
  accentDim: 'rgba(232, 185, 62, 0.14)',
  onAccent: '#0A0A0B',
  danger: '#E5484D',
  warn: '#D97E36',
  success: '#4E9F6A',
};

export const light: ThemePalette = {
  bg: '#F7F5F0',
  surface: '#FFFFFF',
  surface2: '#EFECE4',
  border: '#E2DED4',
  text: '#171310',
  textDim: '#5F5A50',
  textFaint: '#9A937F',
  accent: '#A8761A',
  accentDim: 'rgba(168, 118, 26, 0.12)',
  onAccent: '#FFFFFF',
  danger: '#C93A3E',
  warn: '#B25E1B',
  success: '#3E7F55',
};

export const CATEGORY_TOKENS = ['slate', 'amber', 'teal', 'violet', 'rose', 'sage'] as const;
export type CategoryToken = (typeof CATEGORY_TOKENS)[number];

/** Desaturated, legible on both themes. */
export const categoryColors: Record<CategoryToken, string> = {
  slate: '#8A919C',
  amber: '#C99B3F',
  teal: '#5E9C8F',
  violet: '#8E7FA8',
  rose: '#B76E79',
  sage: '#7FA36B',
};

export function categoryColor(token: string): string {
  return (categoryColors as Record<string, string>)[token] ?? categoryColors.slate;
}

interface TextStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
  fontFamily?: string;
  letterSpacing?: number;
}

const MONO = 'monospace'; // system monospace — tabular numerals for time

export const type: Record<
  'display' | 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'caption' | 'mono' | 'clock',
  TextStyle
> = {
  display: { fontSize: 40, lineHeight: 48, fontWeight: '700' },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: '700' },
  h2: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  h3: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: '500', letterSpacing: 0.8 },
  mono: { fontSize: 13, lineHeight: 18, fontWeight: '400', fontFamily: MONO },
  clock: { fontSize: 52, lineHeight: 60, fontWeight: '600', fontFamily: MONO },
};

export const radius = { sm: 8, md: 12, lg: 16, xl: 20 };

/** 8pt grid. */
export const space = (n: number): number => n * 8;

/** Minimum tap target. */
export const TAP = 48;

/**
 * Soft shadows. Android renders `elevation`; iOS props included for parity.
 * Keep subtle — hairline borders do most of the separation work.
 */
export const shadow = {
  sm: {
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  md: {
    elevation: 5,
    shadowColor: '#000',
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  lg: {
    elevation: 9,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
};
