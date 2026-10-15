/**
 * CheckOff — timers. Focus sessions attached to task instances.
 *
 * HONESTY RULE (documented in docs/NOTES.md): timers cannot run JS after the
 * app is killed. The design is time-derived, not process-derived:
 * - A countdown's end is delivered by the OS via a scheduled notification
 *   (exact DATE trigger); elapsed time is ALWAYS derived from
 *   `started_at_utc` in the DB, never from a live counter.
 * - On every launch/foreground, `reconcileTimers` finalizes sessions whose
 *   planned end passed (countdown) or which ran longer than 12h (stopwatch).
 * - No fake foreground service is claimed. The `sticky` ongoing notification
 *   is a visible anchor the user can tap; it is not a keep-alive.
 *
 * Only one timer may be active at a time: starting a new one finalizes the
 * previous as superseded (actor 'auto').
 */
import * as Notifications from 'expo-notifications';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { EventActor, TimerMode, TimerSession } from '../db/types';
import { logEvent } from '../db/log';
import { nowUtcIso } from '../db/time';
import { newId } from '../db/ids';
import { ALARM_SOUND, TIMER_CHANNEL_ID, TIMER_END_CATEGORY } from '../notifications/index';

export interface StartTimerInput {
  taskInstanceId: string;
  mode: 'countdown' | 'stopwatch';
  plannedMin?: number;
  skillId?: string | null;
}

export interface StopTimerOpts {
  completed?: boolean;
  skillId?: string | null;
}

const STOPWATCH_CAP_MS = 12 * 3600_000;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function rowToSession(row: Record<string, unknown>): TimerSession {
  return {
    id: row.id as string,
    taskInstanceId: (row.task_instance_id as string) ?? null,
    mode: row.mode as TimerMode,
    plannedMin: (row.planned_min as number) ?? null,
    startedAtUtc: row.started_at_utc as string,
    endedAtUtc: (row.ended_at_utc as string) ?? null,
    createdAt: row.created_at as string,
  };
}

function ongoingId(sessionId: string): string {
  return `timer-ongoing-${sessionId}`;
}
function endId(sessionId: string): string {
  return `timer-end-${sessionId}`;
}

/** Deterministic notification identifiers for a session (for pause/resume). */
export function timerNotificationIds(sessionId: string): { ongoing: string; end: string } {
  return { ongoing: ongoingId(sessionId), end: endId(sessionId) };
}

/**
 * Shift a session's start forward by shiftMs (pause compensation).
 * Elapsed time stays derived from started_at_utc, so the display,
 * the countdown end, and reconciliation all remain honest.
 */
export async function shiftTimerStart(
  db: SQLiteDatabase,
  sessionId: string,
  shiftMs: number
): Promise<TimerSession> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM timer_sessions WHERE id = ?',
    sessionId
  );
  if (!row) throw new Error('[checkoff] timer session not found');
  const session = rowToSession(row);
  const shifted = new Date(new Date(session.startedAtUtc).getTime() + shiftMs);
  await db.runAsync('UPDATE timer_sessions SET started_at_utc = ? WHERE id = ?', nowUtcIso(shifted), sessionId);
  return { ...session, startedAtUtc: nowUtcIso(shifted) };
}

/** (Re)schedule the countdown end notification from the row's current start. */
export async function scheduleTimerEndNotification(
  db: SQLiteDatabase,
  sessionId: string
): Promise<void> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM timer_sessions WHERE id = ?',
    sessionId
  );
  if (!row) return;
  const session = rowToSession(row);
  if (session.mode !== 'countdown' || !session.plannedMin || session.endedAtUtc) return;
  const endAt = new Date(new Date(session.startedAtUtc).getTime() + session.plannedMin * 60_000);
  if (endAt.getTime() <= Date.now()) return;
  const title =
    (session.taskInstanceId ? await getInstanceTitle(db, session.taskInstanceId) : null) ?? 'Timer';
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: endId(sessionId),
      content: {
        title: 'Timer complete',
        body: title,
        categoryIdentifier: TIMER_END_CATEGORY,
        sound: ALARM_SOUND,
        data: { timerSessionId: sessionId, kind: 'timer-end' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: endAt,
        channelId: TIMER_CHANNEL_ID,
      },
    });
  } catch (e) {
    console.warn('[checkoff] timer end notification failed', e);
  }
}

async function cancelTimerNotifications(sessionId: string): Promise<void> {
  for (const id of [ongoingId(sessionId), endId(sessionId)]) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // Unknown/already-fired id — nothing to cancel.
    }
  }
}

async function getInstanceTitle(db: SQLiteDatabase, instanceId: string): Promise<string | null> {
  try {
    const row = await db.getFirstAsync<{ title: string }>(
      'SELECT title FROM task_instances WHERE id = ?',
      instanceId
    );
    return row?.title ?? null;
  } catch {
    return null;
  }
}

async function setInstanceSkill(
  db: SQLiteDatabase,
  instanceId: string,
  skillId: string | null | undefined
): Promise<void> {
  if (!skillId) return;
  try {
    await db.runAsync(
      'UPDATE task_instances SET skill_id = ?, updated_at = ? WHERE id = ?',
      skillId,
      nowUtcIso(),
      instanceId
    );
  } catch {
    // skill attribution is advisory; never break the timer flow.
  }
}

/**
 * Start a focus session. Returns the persisted session row.
 */
export async function startTimer(db: SQLiteDatabase, input: StartTimerInput): Promise<TimerSession> {
  // Single-active-timer invariant.
  const active = await getActiveTimer(db);
  if (active) {
    await finalizeSession(db, active, 'auto', {
      completed: false,
      superseded: true,
      actualMin: round1((Date.now() - new Date(active.startedAtUtc).getTime()) / 60000),
    });
  }

  const id = newId('tmr');
  const startedAt = new Date();
  const plannedMin = input.mode === 'countdown' ? input.plannedMin ?? null : null;

  await db.runAsync(
    `INSERT INTO timer_sessions
       (id, task_instance_id, mode, planned_min, started_at_utc, ended_at_utc, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    id,
    input.taskInstanceId,
    input.mode,
    plannedMin,
    nowUtcIso(startedAt),
    nowUtcIso(startedAt)
  );

  await setInstanceSkill(db, input.taskInstanceId, input.skillId ?? null);

  await logEvent(db, {
    eventType: 'timer_session_started',
    actor: 'user',
    taskInstanceId: input.taskInstanceId,
    timerSessionId: id,
    payload: { mode: input.mode, plannedMin, skillId: input.skillId ?? null },
  });

  const title = (await getInstanceTitle(db, input.taskInstanceId)) ?? 'Timer';

  // Ongoing anchor: sticky (Android isOngoing), low-importance channel.
  // v57 supports `sticky`; ChannelAwareTriggerInput ({ channelId }) presents
  // immediately on the timer channel.
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: ongoingId(id),
      content: {
        title: 'Timer running',
        body: input.mode === 'countdown' && plannedMin ? `${title} · ${plannedMin} min` : title,
        sticky: true,
        autoDismiss: false,
        sound: false,
        data: { timerSessionId: id, kind: 'timer-ongoing' },
      },
      trigger: { channelId: TIMER_CHANNEL_ID },
    });
  } catch (e) {
    console.warn('[checkoff] ongoing timer notification failed', e);
  }

  // Countdown end chime: exact DATE trigger on the timer channel.
  if (input.mode === 'countdown' && plannedMin && plannedMin > 0) {
    await scheduleTimerEndNotification(db, id);
  }

  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM timer_sessions WHERE id = ?',
    id
  );
  if (!row) throw new Error('[checkoff] timer session insert failed');
  return rowToSession(row);
}

interface FinalizePayload {
  completed: boolean;
  actualMin: number;
  superseded?: boolean;
  reconciled?: boolean;
  capped?: boolean;
}

async function finalizeSession(
  db: SQLiteDatabase,
  session: TimerSession,
  actor: EventActor,
  extra: Omit<FinalizePayload, 'completed' | 'actualMin'> & Partial<FinalizePayload>
): Promise<TimerSession> {
  const endedAt = new Date();
  const actualMin = round1((endedAt.getTime() - new Date(session.startedAtUtc).getTime()) / 60000);
  const endedIso = nowUtcIso(endedAt);

  await db.runAsync('UPDATE timer_sessions SET ended_at_utc = ? WHERE id = ?', endedIso, session.id);
  await cancelTimerNotifications(session.id);

  const payload: Record<string, unknown> = {
    mode: session.mode,
    plannedMin: session.plannedMin,
    actualMin,
    completed: extra.completed ?? true,
  };
  if (extra.superseded) payload.superseded = true;
  if (extra.reconciled) payload.reconciled = true;
  if (extra.capped) payload.capped = true;

  await logEvent(db, {
    eventType: 'timer_session_ended',
    actor,
    taskInstanceId: session.taskInstanceId,
    timerSessionId: session.id,
    payload,
  });

  return { ...session, endedAtUtc: endedIso };
}

/**
 * Stop the session. Returns the updated row.
 */
export async function stopTimer(
  db: SQLiteDatabase,
  sessionId: string,
  opts?: StopTimerOpts
): Promise<TimerSession> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM timer_sessions WHERE id = ?',
    sessionId
  );
  if (!row) throw new Error('[checkoff] timer session not found');
  const session = rowToSession(row);
  if (session.endedAtUtc) return session; // idempotent

  if (opts?.skillId && session.taskInstanceId) {
    await setInstanceSkill(db, session.taskInstanceId, opts.skillId);
  }

  return finalizeSession(db, session, 'user', { completed: opts?.completed ?? true });
}

/** The currently running session, if any. */
export async function getActiveTimer(db: SQLiteDatabase): Promise<TimerSession | null> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT * FROM timer_sessions
     WHERE ended_at_utc IS NULL
     ORDER BY started_at_utc DESC
     LIMIT 1`
  );
  return row ? rowToSession(row) : null;
}

/**
 * Launch/foreground reconciliation. Finalizes sessions that outlived the app:
 * countdowns past their planned end, stopwatches older than 12h. Actor 'auto'.
 */
export async function reconcileTimers(db: SQLiteDatabase): Promise<void> {
  const nowMs = Date.now();
  let rows: Record<string, unknown>[] = [];
  try {
    rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT * FROM timer_sessions WHERE ended_at_utc IS NULL ORDER BY started_at_utc ASC`
    );
  } catch (e) {
    console.warn('[checkoff] reconcileTimers read failed', e);
    return;
  }
  for (const row of rows) {
    const session = rowToSession(row);
    const startedMs = new Date(session.startedAtUtc).getTime();
    if (Number.isNaN(startedMs)) continue;
    if (session.mode === 'countdown' && session.plannedMin && session.plannedMin > 0) {
      const endMs = startedMs + session.plannedMin * 60_000;
      if (endMs <= nowMs) {
        await finalizeSession(db, session, 'auto', { reconciled: true }).catch(() => {});
      }
    } else if (nowMs - startedMs > STOPWATCH_CAP_MS) {
      await finalizeSession(db, session, 'auto', { reconciled: true, capped: true }).catch(() => {});
    }
  }
}
