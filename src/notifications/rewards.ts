/**
 * CheckOff — reward notifications (local, expo-notifications).
 *
 * Separate from the task-alarm engine (`notifications/index.ts`):
 * - Own Android channel `checkoff-rewards` (DEFAULT importance — these are
 *   informational, never full-screen alarm interruptions).
 * - Rules engine:
 *   - Max 3 reward notifications per calendar day (counts tracked per-day in
 *     the meta table; inexact scheduled triggers count against their fire
 *     date).
 *   - Quiet hours (default 22:00–07:00, configurable): nothing is scheduled
 *     inside the window. The streak-at-risk slot (22:00) is pulled forward to
 *     30 min before quiet start when it collides; user-chosen times that fall
 *     in quiet hours are skipped.
 *   - Per-type toggles live in the meta table and are mirrored in the UI
 *     store; `rescheduleRewardNotifications()` re-arms everything when state
 *     or settings change (boot + app foreground).
 */
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getMeta, setMeta } from '../db/repos/meta';
import { localDateString } from '../db/time';
import {
  getBalance,
  getStreak,
  getUserRewards,
  isDailyGoalMet,
  isDailyRewardClaimable,
} from '../rewards/engine';

export const REWARD_CHANNEL_ID = 'checkoff-rewards';
const REWARD_KIND_PREFIX = 'checkoff-reward:';
const MAX_REWARD_NOTIFICATIONS_PER_DAY = 3;

export type RewardNotifKind =
  | 'streak-risk'
  | 'daily-nudge'
  | 'affordable'
  | 'level-up'
  | 'weekly-review';

// ---------------------------------------------------------------------------
// Meta keys + prefs
// ---------------------------------------------------------------------------

export const REWARD_META_KEYS = {
  streakAlerts: 'reward_notif_streak',
  dailyNudge: 'reward_notif_nudge',
  nudgeTime: 'reward_nudge_time',
  affordableAlerts: 'reward_notif_affordable',
  levelUp: 'reward_notif_levelup',
  weeklyReview: 'reward_notif_weekly',
  quietStart: 'reward_quiet_start',
  quietEnd: 'reward_quiet_end',
} as const;

const DAILY_COUNT_KEY = 'reward_notif_daily_count'; // value: "YYYY-MM-DD:count"
const AFFORDABLE_NOTIFIED_KEY = 'reward_notified_affordable'; // value: JSON string[]
const SCHED_IDS_KEY = 'reward_sched_ids'; // value: JSON string[]

export interface RewardNotifPrefs {
  streakAlerts: boolean;
  dailyNudge: boolean;
  /** 'HH:MM' local time */
  nudgeTime: string;
  affordableAlerts: boolean;
  levelUp: boolean;
  weeklyReview: boolean;
  /** 'HH:MM' local time */
  quietStart: string;
  /** 'HH:MM' local time */
  quietEnd: string;
}

export const REWARD_PREF_DEFAULTS: RewardNotifPrefs = {
  streakAlerts: true,
  dailyNudge: true,
  nudgeTime: '20:00',
  affordableAlerts: true,
  levelUp: true,
  weeklyReview: true,
  quietStart: '22:00',
  quietEnd: '07:00',
};

function isTruthy(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback;
  return raw === '1';
}

export async function loadRewardNotifPrefs(
  db: SQLiteDatabase
): Promise<RewardNotifPrefs> {
  const d = REWARD_PREF_DEFAULTS;
  const [streak, nudge, nudgeTime, affordable, levelUp, weekly, qStart, qEnd] =
    await Promise.all([
      getMeta(db, REWARD_META_KEYS.streakAlerts),
      getMeta(db, REWARD_META_KEYS.dailyNudge),
      getMeta(db, REWARD_META_KEYS.nudgeTime),
      getMeta(db, REWARD_META_KEYS.affordableAlerts),
      getMeta(db, REWARD_META_KEYS.levelUp),
      getMeta(db, REWARD_META_KEYS.weeklyReview),
      getMeta(db, REWARD_META_KEYS.quietStart),
      getMeta(db, REWARD_META_KEYS.quietEnd),
    ]);
  return {
    streakAlerts: isTruthy(streak, d.streakAlerts),
    dailyNudge: isTruthy(nudge, d.dailyNudge),
    nudgeTime: nudgeTime ?? d.nudgeTime,
    affordableAlerts: isTruthy(affordable, d.affordableAlerts),
    levelUp: isTruthy(levelUp, d.levelUp),
    weeklyReview: isTruthy(weekly, d.weeklyReview),
    quietStart: qStart ?? d.quietStart,
    quietEnd: qEnd ?? d.quietEnd,
  };
}

export async function saveRewardNotifPrefs(
  db: SQLiteDatabase,
  patch: Partial<RewardNotifPrefs>
): Promise<void> {
  const entries: [string, string][] = [];
  if (patch.streakAlerts !== undefined)
    entries.push([REWARD_META_KEYS.streakAlerts, patch.streakAlerts ? '1' : '0']);
  if (patch.dailyNudge !== undefined)
    entries.push([REWARD_META_KEYS.dailyNudge, patch.dailyNudge ? '1' : '0']);
  if (patch.nudgeTime !== undefined)
    entries.push([REWARD_META_KEYS.nudgeTime, patch.nudgeTime]);
  if (patch.affordableAlerts !== undefined)
    entries.push([REWARD_META_KEYS.affordableAlerts, patch.affordableAlerts ? '1' : '0']);
  if (patch.levelUp !== undefined)
    entries.push([REWARD_META_KEYS.levelUp, patch.levelUp ? '1' : '0']);
  if (patch.weeklyReview !== undefined)
    entries.push([REWARD_META_KEYS.weeklyReview, patch.weeklyReview ? '1' : '0']);
  if (patch.quietStart !== undefined)
    entries.push([REWARD_META_KEYS.quietStart, patch.quietStart]);
  if (patch.quietEnd !== undefined)
    entries.push([REWARD_META_KEYS.quietEnd, patch.quietEnd]);
  for (const [key, value] of entries) {
    await setMeta(db, key, value);
  }
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

function parseHHMM(raw: string): { h: number; m: number } {
  const [h, m] = raw.split(':').map(Number);
  return {
    h: Number.isFinite(h) ? h : 0,
    m: Number.isFinite(m) ? m : 0,
  };
}

function minutesOf(h: number, m: number): number {
  return h * 60 + m;
}

/**
 * True when `date`'s local time falls inside [quietStart, quietEnd).
 * Handles windows that wrap past midnight (e.g. 22:00–07:00).
 */
export function isInQuietHours(
  date: Date,
  quietStart: string,
  quietEnd: string
): boolean {
  const nowMin = minutesOf(date.getHours(), date.getMinutes());
  const s = parseHHMM(quietStart);
  const e = parseHHMM(quietEnd);
  const startMin = minutesOf(s.h, s.m);
  const endMin = minutesOf(e.h, e.m);
  if (startMin === endMin) return false; // degenerate window = no quiet hours
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;
}

/** Next occurrence of a local 'HH:MM' time (today if still ahead, else tomorrow). */
function nextOccurrence(hhmm: string): Date {
  const { h, m } = parseHHMM(hhmm);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

/** Next Sunday at 19:00 local. */
function nextSundayAt1900(): Date {
  const d = new Date();
  d.setHours(19, 0, 0, 0);
  const dow = d.getDay(); // 0 = Sunday
  const daysAhead = (7 - dow) % 7;
  if (daysAhead === 0 && d.getTime() <= Date.now()) {
    d.setDate(d.getDate() + 7);
  } else {
    d.setDate(d.getDate() + daysAhead);
  }
  return d;
}

/** Today's streak-at-risk slot: 2h before day end (22:00). */
function streakAtRiskTime(): Date {
  const d = new Date();
  d.setHours(22, 0, 0, 0);
  return d;
}

/** True when the app is currently in the foreground. */
export function isAppForeground(): boolean {
  return AppState.currentState === 'active';
}

// ---------------------------------------------------------------------------
// Daily cap + scheduled-id bookkeeping
// ---------------------------------------------------------------------------

async function countForDate(db: SQLiteDatabase, dateStr: string): Promise<number> {
  try {
    const raw = await getMeta(db, DAILY_COUNT_KEY);
    if (!raw) return 0;
    const [day, count] = raw.split(':');
    return day === dateStr ? parseInt(count, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

async function incrementCount(db: SQLiteDatabase, dateStr: string): Promise<void> {
  try {
    const next = (await countForDate(db, dateStr)) + 1;
    await setMeta(db, DAILY_COUNT_KEY, `${dateStr}:${next}`);
  } catch {
    // bookkeeping must never break scheduling
  }
}

interface TrackedSchedule {
  id: string;
  kind: RewardNotifKind;
  /** Local YYYY-MM-DD the notification fires on. */
  fireDay: string;
}

async function readTracked(db: SQLiteDatabase): Promise<TrackedSchedule[]> {
  try {
    const raw = await getMeta(db, SCHED_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Tolerate the legacy string[] format from earlier builds.
    return parsed.flatMap((e): TrackedSchedule[] =>
      typeof e === 'string'
        ? []
        : [
            {
              id: String((e as TrackedSchedule).id ?? ''),
              kind: (e as TrackedSchedule).kind,
              fireDay: String((e as TrackedSchedule).fireDay ?? ''),
            },
          ]
    );
  } catch {
    return [];
  }
}

async function trackScheduledId(
  db: SQLiteDatabase,
  id: string,
  kind: RewardNotifKind,
  fireDay: string
): Promise<void> {
  try {
    const entries = await readTracked(db);
    // Replace any earlier entry for the same kind+fire day (re-arm).
    const kept = entries.filter(
      (t) => !(t.kind === kind && t.fireDay === fireDay)
    );
    kept.push({ id, kind, fireDay });
    await setMeta(db, SCHED_IDS_KEY, JSON.stringify(kept));
  } catch {
    // ignore
  }
}

/**
 * Prune tracked entries whose fire day already passed. Entries for today or
 * later are KEPT even after cancellation so a re-arm of the same kind for
 * the same fire day is not counted twice against the daily cap.
 */
async function pruneTracked(db: SQLiteDatabase): Promise<void> {
  try {
    const today = localDateString();
    const entries = await readTracked(db);
    const kept = entries.filter((t) => t.fireDay >= today);
    await setMeta(db, SCHED_IDS_KEY, JSON.stringify(kept));
  } catch {
    // ignore
  }
}

function isRewardNotification(
  n: Notifications.NotificationRequest
): boolean {
  const kind = (n.content.data as Record<string, unknown> | undefined)?.[
    'kind'
  ];
  return typeof kind === 'string' && kind.startsWith(REWARD_KIND_PREFIX);
}

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

export async function ensureRewardChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(REWARD_CHANNEL_ID, {
      name: 'Reward Updates',
      importance: Notifications.AndroidImportance.DEFAULT,
      enableVibrate: true,
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
  } catch (e) {
    console.warn('[checkoff] could not create rewards channel', e);
  }
}

// ---------------------------------------------------------------------------
// Central scheduling gate
// ---------------------------------------------------------------------------

interface ScheduleRewardOpts {
  kind: RewardNotifKind;
  title: string;
  body: string;
  fireAt: Date;
  toggleOn: boolean;
  data?: Record<string, unknown>;
}

/**
 * Schedules one reward notification after applying the rules engine:
 * per-type toggle → quiet hours → daily cap. Returns the notification id or
 * null when suppressed. Callers never need to catch.
 */
async function scheduleReward(
  db: SQLiteDatabase,
  opts: ScheduleRewardOpts
): Promise<string | null> {
  try {
    if (!opts.toggleOn) return null;
    if (opts.fireAt.getTime() <= Date.now()) return null;

    const prefs = await loadRewardNotifPrefs(db);
    if (isInQuietHours(opts.fireAt, prefs.quietStart, prefs.quietEnd)) {
      return null;
    }
    const fireDay = localDateString(opts.fireAt);
    const tracked = await readTracked(db);
    // Re-arming the same kind for the same fire day (e.g. repeated
    // foregrounds) must not consume the daily cap twice.
    const alreadyCounted = tracked.some(
      (t) => t.kind === opts.kind && t.fireDay === fireDay
    );
    if (
      !alreadyCounted &&
      (await countForDate(db, fireDay)) >= MAX_REWARD_NOTIFICATIONS_PER_DAY
    ) {
      return null;
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: opts.title,
        body: opts.body,
        data: {
          kind: `${REWARD_KIND_PREFIX}${opts.kind}`,
          ...opts.data,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: opts.fireAt,
        channelId: REWARD_CHANNEL_ID,
      },
    });
    await trackScheduledId(db, id, opts.kind, fireDay);
    if (!alreadyCounted) {
      await incrementCount(db, fireDay);
    }
    return id;
  } catch (e) {
    console.warn(`[checkoff] scheduleReward (${opts.kind}) failed`, e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Individual schedulers
// ---------------------------------------------------------------------------

/**
 * Streak at risk: 2h before day end, only when streak >= 3 and the daily
 * goal is still unmet. If 22:00 collides with quiet hours it fires 30 min
 * before quiet start instead (still outside the window).
 */
export async function scheduleStreakAtRisk(db: SQLiteDatabase): Promise<void> {
  try {
    const [streak, goalMet, prefs] = await Promise.all([
      getStreak(db),
      isDailyGoalMet(db),
      loadRewardNotifPrefs(db),
    ]);
    if (streak < 3 || goalMet) return;

    let fireAt = streakAtRiskTime();
    if (isInQuietHours(fireAt, prefs.quietStart, prefs.quietEnd)) {
      const { h, m } = parseHHMM(prefs.quietStart);
      fireAt = new Date();
      fireAt.setHours(h, m, 0, 0);
      fireAt = new Date(fireAt.getTime() - 30 * 60_000);
      if (fireAt.getTime() <= Date.now()) return;
    }

    await scheduleReward(db, {
      kind: 'streak-risk',
      title: 'Streak at risk',
      body: `${streak}-day streak — finish today's goal before midnight to keep it alive.`,
      fireAt,
      toggleOn: prefs.streakAlerts,
    });
  } catch (e) {
    console.warn('[checkoff] scheduleStreakAtRisk failed', e);
  }
}

/**
 * Daily reward nudge: once daily at the user's chosen time (default 20:00),
 * only when a daily reward is earned and still unclaimed.
 */
export async function scheduleDailyRewardNudge(
  db: SQLiteDatabase
): Promise<void> {
  try {
    const [claimable, prefs] = await Promise.all([
      isDailyRewardClaimable(db),
      loadRewardNotifPrefs(db),
    ]);
    if (!claimable) return;

    await scheduleReward(db, {
      kind: 'daily-nudge',
      title: 'Daily reward waiting',
      body: 'You earned a daily reward — open Rewards to claim it.',
      fireAt: nextOccurrence(prefs.nudgeTime),
      toggleOn: prefs.dailyNudge,
    });
  } catch (e) {
    console.warn('[checkoff] scheduleDailyRewardNudge failed', e);
  }
}

async function getAffordableNotifiedIds(db: SQLiteDatabase): Promise<string[]> {
  try {
    const raw = await getMeta(db, AFFORDABLE_NOTIFIED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

async function markAffordableNotified(
  db: SQLiteDatabase,
  ids: string[]
): Promise<void> {
  try {
    await setMeta(db, AFFORDABLE_NOTIFIED_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

/**
 * Affordable-reward alert: when the balance first reaches a user reward's
 * cost, notify once per reward. Event-driven — call after points are granted
 * (and from reschedule for belt-and-braces).
 */
export async function checkRewardAffordable(
  db: SQLiteDatabase
): Promise<void> {
  try {
    const [balance, rewards, notified, prefs] = await Promise.all([
      getBalance(db),
      getUserRewards(db),
      getAffordableNotifiedIds(db),
      loadRewardNotifPrefs(db),
    ]);
    if (!prefs.affordableAlerts) return;

    const newly: string[] = [];
    for (const reward of rewards) {
      if (balance >= reward.cost && !notified.includes(reward.id)) {
        const id = await scheduleReward(db, {
          kind: 'affordable',
          title: 'Reward within reach',
          body: `"${reward.name}" is now affordable with your ${balance} points.`,
          fireAt: new Date(Date.now() + 5_000),
          toggleOn: true,
        });
        if (id) newly.push(reward.id);
      }
    }
    if (newly.length > 0) {
      await markAffordableNotified(db, [...notified, ...newly]);
    }
  } catch (e) {
    console.warn('[checkoff] checkRewardAffordable failed', e);
  }
}

/**
 * Level-up moment: schedules the notification only. The caller decides
 * whether the app is backgrounded — use `isAppForeground()` to skip when an
 * in-app level-up celebration is shown instead; the OS handles display.
 */
export async function notifyLevelUp(
  db: SQLiteDatabase,
  level: number
): Promise<void> {
  try {
    const prefs = await loadRewardNotifPrefs(db);
    await scheduleReward(db, {
      kind: 'level-up',
      title: `Level ${level} reached`,
      body: 'Your consistency paid off — open Rewards to see your progress.',
      fireAt: new Date(Date.now() + 5_000),
      toggleOn: prefs.levelUp,
      data: { level },
    });
  } catch (e) {
    console.warn('[checkoff] notifyLevelUp failed', e);
  }
}

/** Weekly review: Sunday 19:00 local (re-armed on every reschedule). */
export async function scheduleWeeklyReview(
  db: SQLiteDatabase
): Promise<void> {
  try {
    const prefs = await loadRewardNotifPrefs(db);
    await scheduleReward(db, {
      kind: 'weekly-review',
      title: 'Weekly review',
      body: 'Your week in CheckOff: streaks, focus hours, and new badges.',
      fireAt: nextSundayAt1900(),
      toggleOn: prefs.weeklyReview,
    });
  } catch (e) {
    console.warn('[checkoff] scheduleWeeklyReview failed', e);
  }
}

// ---------------------------------------------------------------------------
// Reschedule
// ---------------------------------------------------------------------------

/** Cancel every pending reward notification (tracked ids + live scan). */
export async function cancelRewardNotifications(
  db: SQLiteDatabase
): Promise<void> {
  try {
    const entries = await readTracked(db);
    for (const { id } of entries) {
      if (!id) continue;
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
      } catch {
        // stale id
      }
    }
  } catch {
    // ignore
  }
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of pending) {
      if (isRewardNotification(n)) {
        try {
          await Notifications.cancelScheduledNotificationAsync(n.identifier);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  await pruneTracked(db);
}

/**
 * Cancel all pending reward notifications and re-arm them from current state.
 * Call after any relevant write path (points granted, rewards changed,
 * streak/date changes) and on app foreground/boot.
 */
export async function rescheduleRewardNotifications(
  db: SQLiteDatabase
): Promise<void> {
  await ensureRewardChannel();
  await cancelRewardNotifications(db);
  await scheduleStreakAtRisk(db);
  await scheduleDailyRewardNudge(db);
  await scheduleWeeklyReview(db);
  await checkRewardAffordable(db);
}
