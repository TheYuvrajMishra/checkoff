/**
 * CheckOff design tokens. STABLE — written by the coordinator, do not edit.
 * Dark-first. One accent. Desaturated category palette. 8pt grid.
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
  bg: '#0B0D10',
  surface: '#12161B',
  surface2: '#1A2027',
  border: '#242B33',
  text: '#F2F4F6',
  textDim: '#9AA3AD',
  textFaint: '#5C6570',
  accent: '#E0A83C',
  accentDim: 'rgba(224, 168, 60, 0.14)',
  onAccent: '#0B0D10',
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
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700' },
  h1: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  h2: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  h3: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: '500', letterSpacing: 0.8 },
  mono: { fontSize: 13, lineHeight: 18, fontWeight: '400', fontFamily: MONO },
  clock: { fontSize: 44, lineHeight: 52, fontWeight: '600', fontFamily: MONO },
};

export const radius = { sm: 8, md: 12, lg: 16 };

/** 8pt grid. */
export const space = (n: number): number => n * 8;

/** Minimum tap target. */
export const TAP = 48;
