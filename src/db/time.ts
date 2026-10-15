/**
 * Time helpers. Rule: the device clock is the source of truth.
 * Every event stores UTC ISO + the device offset at write time,
 * so history stays correct across timezone travel and DST changes.
 */

export function nowUtcIso(d: Date = new Date()): string {
  return d.toISOString();
}

/** Minutes east of UTC, e.g. IST => 330. */
export function deviceOffsetMinutes(d: Date = new Date()): number {
  return -d.getTimezoneOffset();
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Local calendar day as "YYYY-MM-DD" using the device clock. */
export function localDateString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local day-of-week index: 0 = Sunday ... 6 = Saturday. */
export function localWeekdayIndex(d: Date = new Date()): number {
  return d.getDay();
}

/** "HH:MM" 24h local time. */
export function localTimeString(d: Date = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Render a stored UTC event timestamp in the device's *current* local time,
 * keeping the original offset available for forensic display.
 */
export function formatEventTime(tsUtc: string, tsOffsetMin: number): string {
  const d = new Date(tsUtc);
  const sign = tsOffsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(tsOffsetMin);
  const off = `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${d.toLocaleString()} (${off} at event time)`;
}

/** Add whole days to a YYYY-MM-DD string, DST-safe via local noon. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, day] = dateStr.split('-').map(Number);
  const d = new Date(y, m - 1, day, 12, 0, 0);
  d.setDate(d.getDate() + days);
  return localDateString(d);
}
