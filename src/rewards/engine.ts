/**
 * CheckOff — rewards/points engine (v4, SQLite-backed).
 *
 * DB is the source of truth. Every earn/spend/reversal is an append-only
 * row in `reward_ledger`; balance is always SUM(points). Evaluation is
 * idempotent: every ledger row carries a `source_event_id` UNIQUE key and
 * inserts use INSERT OR IGNORE, so `evaluateRewards` can safely re-run.
 *
 * NOTE on imports: db/log.ts calls evaluateRewards after every insert,
 * and this module calls logEvent for reward redemptions/claims. The cycle
 * is safe — both modules only touch each other's exports inside function
 * bodies, never at module-evaluation time.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import type {
  Badge,
  LedgerKind,
  LogEvent,
  RewardLedgerRow,
  TaskPriority,
  UserReward,
} from '../db/types';
import { logEvent } from '../db/log';
import { newId } from '../db/ids';
import { getMeta, setMeta } from '../db/repos/meta';
import { addDays, deviceOffsetMinutes, localDateString, nowUtcIso } from '../db/time';

/** Re-exported domain types for UI consumers. */
export type { Badge, RewardLedgerRow, UserReward } from '../db/types';

/* ------------------------------------------------------------------ */
/* Tuning constants                                                    */
/* ------------------------------------------------------------------ */

const PRIORITY_POINTS: Record<TaskPriority, number> = { low: 5, medium: 10, high: 15 };
const RITUAL_BONUS = 5;
const ON_TIME_BONUS_PCT = 0.25;
const PERFECT_DAY_POINTS = 20;
/** Anti-abuse: no points when a task is created and completed within 60s. */
const ABUSE_WINDOW_MS = 60_000;
/** Anti-abuse: max completion earns per template per local day. */
const TEMPLATE_DAILY_EARN_LIMIT = 3;
/** Anti-abuse: max task/focus/perfect-day earn points per local day. */
const DAILY_EARN_CAP = 500;
/** Focus: 1 pt per 10 min, max 6 per session. */
const FOCUS_MIN_PER_POINT = 10;
const FOCUS_SESSION_CAP = 6;
/** Max unconsumed freezes held at once. */
const MAX_FREEZES_HELD = 2;
/** One freeze granted per 7-day streak cycle. */
const FREEZE_STREAK_CYCLE = 7;

const META_ROLLED_THROUGH = 'rewards_rolled_through';
const META_FREEZE_CYCLES = 'rewards_freeze_cycles_granted';

/* ------------------------------------------------------------------ */
/* Daily reward payout table (day 1..7).                               */
/* Spec pins D1/D2/D3/D5/D7; D4/D6 interpolate the curve (assumption,   */
/* documented in the work report).                                     */
/* ------------------------------------------------------------------ */

export interface DailyPayout {
  day: number;
  points: number;
  /** Badge awarded on claim, if any. */
  badgeKey: string | null;
  /** Whether claiming also grants a streak freeze. */
  freeze: boolean;
}

export const DAILY_PAYOUTS: DailyPayout[] = [
  { day: 1, points: 10, badgeKey: null, freeze: false },
  { day: 2, points: 15, badgeKey: null, freeze: false },
  { day: 3, points: 25, badgeKey: 'daily_chest_3', freeze: false },
  { day: 4, points: 35, badgeKey: null, freeze: false },
  { day: 5, points: 50, badgeKey: 'daily_chest_5', freeze: false },
  { day: 6, points: 75, badgeKey: null, freeze: false },
  { day: 7, points: 100, badgeKey: 'weekly_champion', freeze: true },
];

/* ------------------------------------------------------------------ */
/* Badge catalog                                                       */
/* ------------------------------------------------------------------ */

export type BadgeIcon = 'streak' | 'completions' | 'focus' | 'skills';

export interface BadgeView {
  key: string;
  name: string;
  description: string;
  /** Lucide icon key used by the Rewards tab to pick an icon. */
  icon: BadgeIcon;
  thresholdLabel: string;
  earned: boolean;
  earnedAt: string | null;
}

const BADGE_CATALOG: Omit<BadgeView, 'earned' | 'earnedAt'>[] = [
  { key: 'streak_3', name: '3-Day Streak', description: 'Complete your daily goal 3 days in a row', icon: 'streak', thresholdLabel: '3 days' },
  { key: 'streak_7', name: '7-Day Streak', description: 'Complete your daily goal 7 days in a row', icon: 'streak', thresholdLabel: '7 days' },
  { key: 'streak_14', name: '2-Week Streak', description: 'Complete your daily goal 14 days in a row', icon: 'streak', thresholdLabel: '14 days' },
  { key: 'streak_30', name: '30-Day Streak', description: 'Complete your daily goal 30 days in a row', icon: 'streak', thresholdLabel: '30 days' },
  { key: 'streak_60', name: '60-Day Streak', description: 'Complete your daily goal 60 days in a row', icon: 'streak', thresholdLabel: '60 days' },
  { key: 'streak_100', name: '100-Day Streak', description: 'Complete your daily goal 100 days in a row', icon: 'streak', thresholdLabel: '100 days' },
  { key: 'completions_100', name: 'Century', description: 'Complete 100 tasks', icon: 'completions', thresholdLabel: '100 tasks' },
  { key: 'focus_10h', name: 'Deep Focus', description: 'Log 10 hours of focus time', icon: 'focus', thresholdLabel: '10 hours' },
  { key: 'creative_10', name: 'Creative Mind', description: 'Practice 10 distinct skills', icon: 'skills', thresholdLabel: '10 skills' },
  { key: 'daily_chest_3', name: 'Day-3 Chest', description: 'Claimed day 3 of the daily reward streak', icon: 'completions', thresholdLabel: 'daily reward day 3' },
  { key: 'daily_chest_5', name: 'Day-5 Chest', description: 'Claimed day 5 of the daily reward streak', icon: 'completions', thresholdLabel: 'daily reward day 5' },
  { key: 'weekly_champion', name: 'Perfect Week', description: 'Claimed 7 consecutive daily rewards', icon: 'streak', thresholdLabel: '7 daily claims' },
];

const STREAK_BADGE_DAYS = [3, 7, 14, 30, 60, 100];

/** Level threshold: 100 x n^1.5 points of lifetime earn (from zero). */
export function levelThreshold(n: number): number {
  return Math.floor(100 * Math.pow(n, 1.5));
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Local calendar day of a log event, from its UTC ts + captured offset. */
function localDayOfEvent(e: LogEvent): string {
  const d = new Date(new Date(e.tsUtc).getTime() + e.tsOffsetMin * 60000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Local "HH:MM" of a log event, from its UTC ts + captured offset. */
function localHmOfEvent(e: LogEvent): string {
  const d = new Date(new Date(e.tsUtc).getTime() + e.tsOffsetMin * 60000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** SQLite local-day expression over a UTC timestamp column (device offset). */
function localDayExpr(column = 'ts_utc'): string {
  const off = deviceOffsetMinutes(new Date());
  const sign = off >= 0 ? '+' : '-';
  return `date(${column}, '${sign}${Math.abs(off)} minutes')`;
}

function rowToLedger(row: Record<string, unknown>): RewardLedgerRow {
  return {
    id: row.id as string,
    tsUtc: row.ts_utc as string,
    kind: row.kind as LedgerKind,
    points: Number(row.points ?? 0),
    reason: row.reason as string,
    sourceEventId: (row.source_event_id as string) ?? null,
    templateId: (row.template_id as string) ?? null,
    balanceAfter: Number(row.balance_after ?? 0),
  };
}

interface ClaimRow {
  id: string;
  date: string;
  dayNumber: number;
  claimedAtUtc: string;
  pointsAwarded: number;
}

function rowToClaim(row: Record<string, unknown>): ClaimRow {
  return {
    id: row.id as string,
    date: row.date as string,
    dayNumber: Number(row.day_number ?? 1),
    claimedAtUtc: row.claimed_at_utc as string,
    pointsAwarded: Number(row.points_awarded ?? 0),
  };
}

function rowToUserReward(row: Record<string, unknown>): UserReward {
  return {
    id: row.id as string,
    name: row.name as string,
    cost: Number(row.cost ?? 0),
    createdAtUtc: row.created_at_utc as string,
    redeemedCount: Number(row.redeemed_count ?? 0),
  };
}

function rowToBadge(row: Record<string, unknown>): Badge {
  return {
    id: row.id as string,
    badgeKey: row.badge_key as string,
    name: row.name as string,
    description: row.description as string,
    earnedAtUtc: row.earned_at_utc as string,
  };
}

/* ------------------------------------------------------------------ */
/* Day qualification: the shared "goal met" predicate.                 */
/* A day qualifies when every ritual is done and >=80% of tasks are     */
/* done. Days with no tasks are 'empty' (neutral for streaks).          */
/* ------------------------------------------------------------------ */

export type DayQuality = 'qualifying' | 'nonqualifying' | 'empty';

export async function dayQuality(db: SQLiteDatabase, date: string): Promise<DayQuality> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
            SUM(is_ritual) AS rituals_total,
            SUM(CASE WHEN is_ritual = 1 AND status = 'done' THEN 1 ELSE 0 END) AS rituals_done
     FROM task_instances WHERE date = ? AND deleted = 0`,
    date
  );
  const total = Number(row?.total ?? 0);
  if (total === 0) return 'empty';
  const done = Number(row?.done ?? 0);
  const ritualsTotal = Number(row?.rituals_total ?? 0);
  const ritualsDone = Number(row?.rituals_done ?? 0);
  const ritualsOk = ritualsTotal === 0 || ritualsDone >= ritualsTotal;
  return ritualsOk && done / total >= 0.8 ? 'qualifying' : 'nonqualifying';
}

/* ------------------------------------------------------------------ */
/* Streaks + freezes.                                                  */
/*                                                                     */
/* Streaks are derived, never stored: scan back over dayQuality.       */
/* Missed days are rolled forward lazily (cursor in meta) and absorb    */
/* one freeze each when available; the absorbed date is recorded on the */
/* freeze row so consumption is idempotent across repeated reads.      */
/* ------------------------------------------------------------------ */

/** Consume one freeze for a missed local day. Idempotent per day. */
async function absorbMissedDay(db: SQLiteDatabase, date: string): Promise<boolean> {
  const already = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM streak_freezes WHERE absorbed_date = ? LIMIT 1',
    date
  );
  if (already) return true;
  const freeze = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM streak_freezes
     WHERE consumed_at_utc IS NULL AND absorbed_date IS NULL
     ORDER BY earned_at_utc ASC LIMIT 1`
  );
  if (!freeze) return false;
  await db.runAsync(
    'UPDATE streak_freezes SET consumed_at_utc = ?, absorbed_date = ? WHERE id = ?',
    nowUtcIso(),
    date,
    freeze.id
  );
  return true;
}

/** Roll every day before `today` through the freeze-absorption pass. */
async function rollMissedDays(db: SQLiteDatabase, today: string): Promise<void> {
  const lastRolled = await getMeta(db, META_ROLLED_THROUGH);
  let d = lastRolled ? addDays(lastRolled, 1) : addDays(today, -60);
  while (d < today) {
    const q = await dayQuality(db, d);
    if (q === 'nonqualifying') {
      await absorbMissedDay(db, d);
    }
    await setMeta(db, META_ROLLED_THROUGH, d);
    d = addDays(d, 1);
  }
}

/**
 * Consecutive qualifying days. Today counts when it already qualifies;
 * an in-progress today neither extends nor breaks the streak. Empty days
 * are skipped; a freeze-absorbed missed day preserves the streak.
 */
export async function currentStreak(db: SQLiteDatabase, today: string = localDateString()): Promise<number> {
  await rollMissedDays(db, today);
  // Bound the backward scan at the earliest date with any task data.
  const earliest = await db.getFirstAsync<{ d: string }>(
    'SELECT MIN(date) AS d FROM task_instances'
  );
  const stopDate = earliest?.d ?? today;
  let streak = 0;
  if ((await dayQuality(db, today)) === 'qualifying') streak += 1;
  let d = addDays(today, -1);
  for (let i = 0; i < 400 && d >= stopDate; i++) {
    const q = await dayQuality(db, d);
    if (q === 'qualifying') {
      streak += 1;
    } else if (q === 'empty') {
      // neutral — keep scanning
    } else {
      const absorbed = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM streak_freezes WHERE absorbed_date = ? LIMIT 1',
        d
      );
      if (absorbed) streak += 1;
      else break;
    }
    d = addDays(d, -1);
  }
  return streak;
}

/** Number of unconsumed freezes currently held. */
export async function getFreezes(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM streak_freezes WHERE consumed_at_utc IS NULL'
  );
  return row?.n ?? 0;
}

/** Grant 1 freeze per 7-day streak cycle, capped at MAX_FREEZES_HELD. */
async function maybeGrantStreakFreeze(db: SQLiteDatabase): Promise<void> {
  const streak = await currentStreak(db);
  const granted = Number((await getMeta(db, META_FREEZE_CYCLES)) ?? '0') || 0;
  const cycles = Math.floor(streak / FREEZE_STREAK_CYCLE);
  let g = granted;
  while (g < cycles) {
    if ((await getFreezes(db)) >= MAX_FREEZES_HELD) break;
    await db.runAsync(
      'INSERT INTO streak_freezes (id, earned_at_utc, consumed_at_utc, absorbed_date) VALUES (?, ?, NULL, NULL)',
      newId('frz'),
      nowUtcIso()
    );
    g += 1;
  }
  if (g !== granted) await setMeta(db, META_FREEZE_CYCLES, String(g));
}

/* ------------------------------------------------------------------ */
/* Ledger primitives                                                   */
/* ------------------------------------------------------------------ */

/** Insert a ledger row; returns false when the idempotency key already exists. */
async function insertLedger(
  db: SQLiteDatabase,
  input: { kind: LedgerKind; points: number; reason: string; sourceEventId: string; templateId?: string | null }
): Promise<boolean> {
  const balance = await getBalance(db);
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO reward_ledger
       (id, ts_utc, kind, points, reason, source_event_id, template_id, balance_after)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    newId('ldg'),
    nowUtcIso(),
    input.kind,
    input.points,
    input.reason,
    input.sourceEventId,
    input.templateId ?? null,
    balance + input.points
  );
  return result.changes === 1;
}

/** Current point balance: earned - spent - reversed. */
export async function getBalance(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ s: number }>(
    'SELECT COALESCE(SUM(points), 0) AS s FROM reward_ledger'
  );
  return row?.s ?? 0;
}

/**
 * Lifetime earned points (earn rows only) — the level input.
 * Spending never lowers level; reversals don't either (level = lifetime achievement).
 */
export async function getLifetimeEarned(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ s: number }>(
    "SELECT COALESCE(SUM(points), 0) AS s FROM reward_ledger WHERE kind = 'earn'"
  );
  return row?.s ?? 0;
}

/** Earn points (kind='earn') already banked on a local day — for the daily cap. */
async function dailyEarned(db: SQLiteDatabase, date: string): Promise<number> {
  const row = await db.getFirstAsync<{ s: number }>(
    `SELECT COALESCE(SUM(points), 0) AS s FROM reward_ledger
     WHERE kind = 'earn' AND ${localDayExpr()} = ?`,
    date
  );
  return row?.s ?? 0;
}

/** Completion earns already banked for a template on a local day. */
async function templateEarnCount(db: SQLiteDatabase, templateId: string, date: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM reward_ledger
     WHERE kind = 'earn' AND template_id = ? AND ${localDayExpr()} = ?`,
    templateId,
    date
  );
  return row?.n ?? 0;
}

function streakMultiplier(streak: number): number {
  return 1 + Math.min(streak, 30) * 0.01;
}

/* ------------------------------------------------------------------ */
/* Level                                                               */
/* ------------------------------------------------------------------ */

export interface LevelInfo {
  level: number;
  /** 0..1 progress toward the next level. */
  progress: number;
  currentThreshold: number;
  nextThreshold: number;
}

/** Level n threshold = 100 * n^1.5. Derived from lifetime earn, so spending never lowers it. */
export async function getLevel(db: SQLiteDatabase): Promise<LevelInfo> {
  const earned = await getLifetimeEarned(db);
  let level = 0;
  while (earned >= 100 * Math.pow(level + 1, 1.5)) level += 1;
  const currentThreshold = level === 0 ? 0 : Math.floor(100 * Math.pow(level, 1.5));
  const nextThreshold = Math.floor(100 * Math.pow(level + 1, 1.5));
  const span = nextThreshold - currentThreshold;
  const progress = span <= 0 ? 1 : Math.min(1, Math.max(0, (earned - currentThreshold) / span));
  return { level, progress, currentThreshold, nextThreshold };
}

/* ------------------------------------------------------------------ */
/* Event handlers (called from evaluateRewards)                        */
/* ------------------------------------------------------------------ */

async function handleCompletion(db: SQLiteDatabase, event: LogEvent): Promise<void> {
  const instanceId = event.taskInstanceId;
  if (!instanceId) return;
  const inst = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM task_instances WHERE id = ?',
    instanceId
  );
  if (!inst || (inst.deleted as number) === 1) return;

  // Anti-abuse: created AND completed within 1 minute earns nothing.
  const createdMs = new Date(inst.created_at as string).getTime();
  const completedMs = new Date(event.tsUtc).getTime();
  if (Number.isFinite(createdMs) && Number.isFinite(completedMs) && completedMs - createdMs < ABUSE_WINDOW_MS) {
    return;
  }

  const priority = ((inst.priority as TaskPriority) ?? 'medium') as TaskPriority;
  let points = PRIORITY_POINTS[priority] ?? PRIORITY_POINTS.medium;
  if ((inst.is_ritual as number) === 1) points += RITUAL_BONUS;

  // On-time bonus: completed at/before the scheduled alarm time (local).
  const alarmTime = inst.alarm_time as string | null;
  if (alarmTime && localHmOfEvent(event) <= alarmTime) {
    points = Math.round(points * (1 + ON_TIME_BONUS_PCT));
  }

  const streak = await currentStreak(db);
  points = Math.round(points * streakMultiplier(streak));

  const date = (inst.date as string) || localDayOfEvent(event);
  const templateId = (inst.template_id as string) ?? null;

  // Anti-abuse: per-template daily earn cap.
  if (templateId && (await templateEarnCount(db, templateId, date)) >= TEMPLATE_DAILY_EARN_LIMIT) {
    return;
  }
  // Anti-abuse: daily earn cap.
  const remaining = DAILY_EARN_CAP - (await dailyEarned(db, date));
  if (remaining <= 0) return;
  points = Math.min(points, remaining);
  if (points <= 0) return;

  const inserted = await insertLedger(db, {
    kind: 'earn',
    points,
    reason: `Task completed: ${inst.title as string}`,
    sourceEventId: String(event.id),
    templateId,
  });
  if (!inserted) return;
  await checkBadges(db);
  await maybePerfectDay(db, date);
}

/** Perfect-day bonus: +20 once per qualifying day (all rituals + >=80% tasks). */
async function maybePerfectDay(db: SQLiteDatabase, date: string): Promise<void> {
  if ((await dayQuality(db, date)) !== 'qualifying') return;
  const remaining = DAILY_EARN_CAP - (await dailyEarned(db, date));
  if (remaining <= 0) return;
  const streak = await currentStreak(db);
  const points = Math.min(Math.round(PERFECT_DAY_POINTS * streakMultiplier(streak)), remaining);
  if (points <= 0) return;
  await insertLedger(db, {
    kind: 'earn',
    points,
    reason: `Perfect day bonus (${date})`,
    sourceEventId: `perfect-day:${date}`,
  });
}

/** Uncheck after a completion: reversal row negating the original earn. */
async function handleUncheck(db: SQLiteDatabase, event: LogEvent): Promise<void> {
  if (!event.taskInstanceId || event.payload?.from !== 'done') return;
  const completed = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM log_events
     WHERE event_type = 'completed' AND task_instance_id = ? AND id < ?
     ORDER BY id DESC LIMIT 1`,
    event.taskInstanceId,
    event.id
  );
  if (!completed) return;
  const earn = await db.getFirstAsync<{ points: number }>(
    "SELECT points FROM reward_ledger WHERE source_event_id = ? AND kind = 'earn' LIMIT 1",
    String(completed.id)
  );
  if (!earn) return; // nothing was awarded (caps/abuse) — nothing to reverse
  await insertLedger(db, {
    kind: 'reversal',
    points: -Math.abs(Number(earn.points)),
    reason: `Reversed completion earn (event ${completed.id})`,
    sourceEventId: `reversal:${completed.id}`,
  });
}

/** Focus session end: 1 pt per 10 min, capped at 6 per session. */
async function handleFocusEnd(db: SQLiteDatabase, event: LogEvent): Promise<void> {
  const payload = event.payload ?? {};
  if (payload.completed === false || payload.superseded === true) return;

  let minutes = Number(payload.actualMin);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    if (!event.timerSessionId) return;
    const s = await db.getFirstAsync<Record<string, unknown>>(
      'SELECT started_at_utc, ended_at_utc FROM timer_sessions WHERE id = ?',
      event.timerSessionId
    );
    const start = new Date(s?.started_at_utc as string).getTime();
    const end = new Date(s?.ended_at_utc as string).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    minutes = (end - start) / 60000;
  }

  let points = Math.min(FOCUS_SESSION_CAP, Math.floor(minutes / FOCUS_MIN_PER_POINT));
  if (points <= 0) return;

  const streak = await currentStreak(db);
  points = Math.round(points * streakMultiplier(streak));

  const date = localDayOfEvent(event);
  const remaining = DAILY_EARN_CAP - (await dailyEarned(db, date));
  if (remaining <= 0) return;
  points = Math.min(points, remaining);
  if (points <= 0) return;

  const inserted = await insertLedger(db, {
    kind: 'earn',
    points,
    reason: `Focus session (${Math.round(minutes)} min)`,
    sourceEventId: `focus:${event.id}`,
  });
  if (inserted) await checkBadges(db);
}

/**
 * Runs after every log insert (wired in db/log.ts). Fire-and-forget safe:
 * never throws — failures are logged and swallowed so the log insert
 * that triggered evaluation is never broken.
 */
export async function evaluateRewards(db: SQLiteDatabase, event: LogEvent): Promise<void> {
  try {
    switch (event.eventType) {
      case 'completed':
        await handleCompletion(db, event);
        break;
      case 'unchecked':
        await handleUncheck(db, event);
        break;
      case 'timer_session_ended':
        await handleFocusEnd(db, event);
        break;
      default:
        break;
    }
    await maybeGrantStreakFreeze(db);
  } catch (e) {
    console.warn('[checkoff] reward evaluation failed', e);
  }
}

/* ------------------------------------------------------------------ */
/* Today stats                                                         */
/* ------------------------------------------------------------------ */

export interface TodayStats {
  streak: number;
  tasksDone: number;
  tasksTotal: number;
  focusMinutes: number;
  /** Current point balance. */
  totalPoints: number;
  /** 0..1 day progress (done/total). */
  dayProgress: number;
}

export async function getTodayStats(db: SQLiteDatabase, date: string): Promise<TodayStats> {
  const [y, m, d] = date.split('-').map(Number);
  const startUtc = new Date(y, m - 1, d, 0, 0, 0).toISOString();
  const endUtc = new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();

  const day = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
     FROM task_instances WHERE date = ? AND deleted = 0`,
    date
  );
  const tasksTotal = Number(day?.total ?? 0);
  const tasksDone = Number(day?.done ?? 0);

  const focus = await db.getFirstAsync<{ mins: number }>(
    `SELECT COALESCE(SUM((strftime('%s', ended_at_utc) - strftime('%s', started_at_utc)) / 60.0), 0) AS mins
     FROM timer_sessions WHERE ended_at_utc >= ? AND ended_at_utc <= ?`,
    startUtc,
    endUtc
  );

  return {
    streak: await currentStreak(db, date),
    tasksDone,
    tasksTotal,
    focusMinutes: Math.round((focus?.mins ?? 0) * 10) / 10,
    totalPoints: await getBalance(db),
    dayProgress: tasksTotal > 0 ? tasksDone / tasksTotal : 0,
  };
}

/* ------------------------------------------------------------------ */
/* Daily rewards (1..7 claim streak)                                    */
/* ------------------------------------------------------------------ */

export interface DailyRewardState {
  /** Day position 1..7 for `date` if claimed now. */
  currentDay: number;
  /** Daily goal met for `date` (all rituals + >=80% tasks). */
  earned: boolean;
  claimed: boolean;
  payouts: DailyPayout[];
}

async function getClaim(db: SQLiteDatabase, date: string): Promise<ClaimRow | null> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM daily_reward_claims WHERE date = ?',
    date
  );
  return row ? rowToClaim(row) : null;
}

/**
 * Effective streak day-number for a date: the claim's day_number, or the
 * previous day's number carried through a freeze-absorbed missed day,
 * or 0 when the streak is broken.
 */
async function effectiveDayNumber(db: SQLiteDatabase, date: string, depth = 0): Promise<number> {
  if (depth > 90) return 0;
  const claim = await getClaim(db, date);
  if (claim) return claim.dayNumber;
  const absorbed = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM streak_freezes WHERE absorbed_date = ? LIMIT 1',
    date
  );
  if (absorbed) return effectiveDayNumber(db, addDays(date, -1), depth + 1);
  return 0;
}

export async function getDailyRewardState(db: SQLiteDatabase, date: string): Promise<DailyRewardState> {
  const prev = await effectiveDayNumber(db, addDays(date, -1));
  return {
    currentDay: (prev % 7) + 1,
    earned: (await dayQuality(db, date)) === 'qualifying',
    claimed: (await getClaim(db, date)) !== null,
    payouts: DAILY_PAYOUTS,
  };
}

export interface ClaimExtras {
  badges: string[];
  freezes: number;
}

export interface ClaimResult {
  pointsAwarded: number;
  extras: ClaimExtras;
}

/**
 * Claim the daily reward for `date`. Only today's window is claimable —
 * unclaimed days expire at midnight and don't carry. Advances the 1..7
 * streak; a missed day resets to 1 unless a freeze absorbed it; after
 * day 7 the streak restarts at 1.
 */
export async function claimDailyReward(db: SQLiteDatabase, date: string): Promise<ClaimResult> {
  if (date !== localDateString()) {
    throw new Error('Daily rewards can only be claimed for today; unclaimed days expire at midnight.');
  }
  const state = await getDailyRewardState(db, date);
  if (state.claimed) throw new Error('Daily reward already claimed for this date.');
  if (!state.earned) throw new Error('Daily goal not met yet (all rituals done + at least 80% of tasks).');

  const payout = DAILY_PAYOUTS[state.currentDay - 1];
  await db.runAsync(
    'INSERT INTO daily_reward_claims (id, date, day_number, claimed_at_utc, points_awarded) VALUES (?, ?, ?, ?, ?)',
    newId('drc'),
    date,
    state.currentDay,
    nowUtcIso(),
    payout.points
  );
  // Claim payouts are flat bonuses (no streak multiplier, outside the daily earn cap).
  await insertLedger(db, {
    kind: 'earn',
    points: payout.points,
    reason: `Daily reward — day ${state.currentDay}`,
    sourceEventId: `claim:${date}`,
  });

  const extras: ClaimExtras = { badges: [], freezes: 0 };
  if (payout.badgeKey) {
    if (await awardBadge(db, payout.badgeKey)) extras.badges.push(payout.badgeKey);
  }
  if (payout.freeze && (await getFreezes(db)) < MAX_FREEZES_HELD) {
    await db.runAsync(
      'INSERT INTO streak_freezes (id, earned_at_utc, consumed_at_utc, absorbed_date) VALUES (?, ?, NULL, NULL)',
      newId('frz'),
      nowUtcIso()
    );
    extras.freezes = 1;
  }

  await logEvent(db, {
    eventType: 'daily_reward_claimed',
    actor: 'user',
    payload: { date, dayNumber: state.currentDay, points: payout.points },
  });
  await checkBadges(db);
  return { pointsAwarded: payout.points, extras };
}

/* ------------------------------------------------------------------ */
/* User rewards (redeemable)                                            */
/* ------------------------------------------------------------------ */

export async function getUserRewards(db: SQLiteDatabase): Promise<UserReward[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM user_rewards ORDER BY created_at_utc ASC'
  );
  return rows.map(rowToUserReward);
}

export async function addUserReward(db: SQLiteDatabase, name: string, cost: number): Promise<UserReward> {
  const clean = name.trim();
  if (!clean) throw new Error('Reward name must not be empty.');
  if (!Number.isInteger(cost) || cost <= 0) {
    throw new Error('Reward cost must be a positive integer.');
  }
  const id = newId('rwd');
  const now = nowUtcIso();
  await db.runAsync(
    'INSERT INTO user_rewards (id, name, cost, created_at_utc, redeemed_count) VALUES (?, ?, ?, ?, 0)',
    id,
    clean,
    cost,
    now
  );
  return { id, name: clean, cost, createdAtUtc: now, redeemedCount: 0 };
}

/**
 * Redeem a user reward: writes a spend row + a log event, decrements the
 * balance. Throws when the reward is missing or the balance is short.
 */
export async function redeemReward(db: SQLiteDatabase, id: string): Promise<UserReward> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM user_rewards WHERE id = ?',
    id
  );
  if (!row) throw new Error(`Reward "${id}" not found.`);
  const reward = rowToUserReward(row);
  const balance = await getBalance(db);
  if (balance < reward.cost) {
    throw new Error(`Insufficient points (need ${reward.cost}, have ${balance}).`);
  }
  const inserted = await insertLedger(db, {
    kind: 'spend',
    points: -reward.cost,
    reason: `Redeemed reward: ${reward.name}`,
    sourceEventId: `redeem:${id}:${reward.redeemedCount + 1}`,
  });
  if (inserted) {
    await db.runAsync('UPDATE user_rewards SET redeemed_count = redeemed_count + 1 WHERE id = ?', id);
  }
  await logEvent(db, {
    eventType: 'reward_redeemed',
    actor: 'user',
    payload: { rewardId: id, name: reward.name, cost: reward.cost },
  });
  const updated = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM user_rewards WHERE id = ?',
    id
  );
  return updated ? rowToUserReward(updated) : reward;
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

/** Full badge gallery merged with earned state (drives the Rewards tab). */
export async function getBadges(db: SQLiteDatabase): Promise<BadgeView[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM badges');
  const earned = new Map<string, Badge>();
  for (const r of rows) {
    const b = rowToBadge(r);
    earned.set(b.badgeKey, b);
  }
  return BADGE_CATALOG.map((def) => {
    const b = earned.get(def.key);
    return { ...def, earned: !!b, earnedAt: b?.earnedAtUtc ?? null };
  });
}

/** Award a badge by key; returns true when newly awarded. */
async function awardBadge(db: SQLiteDatabase, key: string): Promise<boolean> {
  const def = BADGE_CATALOG.find((d) => d.key === key);
  if (!def) return false;
  const result = await db.runAsync(
    'INSERT OR IGNORE INTO badges (id, badge_key, name, description, earned_at_utc) VALUES (?, ?, ?, ?, ?)',
    newId('bdg'),
    def.key,
    def.name,
    def.description,
    nowUtcIso()
  );
  return result.changes === 1;
}

/**
 * Evaluate threshold badges (streaks, 100 completions, 10h focus,
 * 10 distinct skills practiced). Returns newly awarded badges.
 */
export async function checkBadges(db: SQLiteDatabase): Promise<Badge[]> {
  const awarded: Badge[] = [];
  const take = async (key: string) => {
    if (await awardBadge(db, key)) {
      const row = await db.getFirstAsync<Record<string, unknown>>(
        'SELECT * FROM badges WHERE badge_key = ?',
        key
      );
      if (row) awarded.push(rowToBadge(row));
    }
  };

  const streak = await currentStreak(db);
  for (const days of STREAK_BADGE_DAYS) {
    if (streak >= days) await take(`streak_${days}`);
  }

  const completions = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM task_instances WHERE status = 'done' AND deleted = 0"
  );
  if ((completions?.n ?? 0) >= 100) await take('completions_100');

  const focus = await db.getFirstAsync<{ mins: number }>(
    `SELECT COALESCE(SUM((strftime('%s', ended_at_utc) - strftime('%s', started_at_utc)) / 60.0), 0) AS mins
     FROM timer_sessions WHERE ended_at_utc IS NOT NULL`
  );
  if ((focus?.mins ?? 0) >= 600) await take('focus_10h');

  const skillRows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT DISTINCT skill_id AS id FROM task_instances
     WHERE skill_id IS NOT NULL AND status = 'done' AND deleted = 0`
  );
  const payloadRows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT DISTINCT json_extract(payload, '$.skillId') AS id FROM log_events
     WHERE event_type = 'timer_session_ended'
       AND json_extract(payload, '$.skillId') IS NOT NULL`
  );
  const skills = new Set<string>();
  for (const r of [...skillRows, ...payloadRows]) {
    if (r.id) skills.add(r.id as string);
  }
  if (skills.size >= 10) await take('creative_10');

  return awarded;
}

/* ------------------------------------------------------------------ */
/* Ledger history                                                      */
/* ------------------------------------------------------------------ */

export async function getLedgerHistory(db: SQLiteDatabase, limit = 50): Promise<RewardLedgerRow[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM reward_ledger ORDER BY ts_utc DESC, id DESC LIMIT ?',
    Math.max(1, Math.floor(limit))
  );
  return rows.map(rowToLedger);
}

/* ------------------------------------------------------------------ */
/* Convenience reads used by the Rewards tab, tab badge + schedulers    */
/* ------------------------------------------------------------------ */

/** Current streak (alias of currentStreak). */
export async function getStreak(db: SQLiteDatabase): Promise<number> {
  return currentStreak(db);
}

/** Whether the daily goal is met for a date (default today). */
export async function isDailyGoalMet(db: SQLiteDatabase, date: string = localDateString()): Promise<boolean> {
  return (await dayQuality(db, date)) === 'qualifying';
}

/** Whether a daily reward is earned and still unclaimed for a date. */
export async function isDailyRewardClaimable(
  db: SQLiteDatabase,
  date: string = localDateString()
): Promise<boolean> {
  const state = await getDailyRewardState(db, date);
  return state.earned && !state.claimed;
}
