import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';
import type { EventActor, LogEvent, LogEventType } from './types';
import { deviceOffsetMinutes, nowUtcIso } from './time';
import { evaluateRewards } from '../rewards/engine';

export interface LogInput {
  eventType: LogEventType;
  actor?: EventActor;
  taskInstanceId?: string | null;
  templateId?: string | null;
  timerSessionId?: string | null;
  /** Structured context — old/new values, trigger details, grace-window config, etc. */
  payload?: Record<string, unknown> | null;
}

/**
 * THE log engine. Append-only by construction:
 * this module exposes insert + read. There is intentionally
 * NO update / delete / upsert API for log_events anywhere.
 *
 * Every feature in the app (tasks, alarms, timers, streaks, overrides,
 * exports) must write through here. If it isn't in the log, it didn't happen.
 */
export async function logEvent(db: SQLiteDatabase, input: LogInput): Promise<number> {
  const now = new Date();
  const tsUtc = nowUtcIso(now);
  const tsOffsetMin = deviceOffsetMinutes(now);
  const result = await db.runAsync(
    `INSERT INTO log_events
       (ts_utc, ts_offset_min, event_type, task_instance_id, template_id,
        timer_session_id, actor, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    tsUtc,
    tsOffsetMin,
    input.eventType,
    input.taskInstanceId ?? null,
    input.templateId ?? null,
    input.timerSessionId ?? null,
    input.actor ?? 'user',
    input.payload ? JSON.stringify(input.payload) : null
  );
  const id = Number(result.lastInsertRowId);
  // Fire-and-forget: reward evaluation must never break the log insert.
  try {
    await evaluateRewards(db, {
      id,
      tsUtc,
      tsOffsetMin,
      eventType: input.eventType,
      taskInstanceId: input.taskInstanceId ?? null,
      templateId: input.templateId ?? null,
      timerSessionId: input.timerSessionId ?? null,
      actor: input.actor ?? 'user',
      payload: input.payload ?? null,
      createdAt: tsUtc,
    });
  } catch (e) {
    console.warn('[checkoff] reward evaluation failed', e);
  }
  return id;
}

export interface LogFilters {
  /** Local day filter: matches events whose UTC ts falls on this local date. */
  day?: string; // YYYY-MM-DD
  taskInstanceId?: string;
  templateId?: string;
  eventTypes?: LogEventType[];
  limit?: number;
}

function rowToEvent(row: Record<string, unknown>): LogEvent {
  return {
    id: row.id as number,
    tsUtc: row.ts_utc as string,
    tsOffsetMin: row.ts_offset_min as number,
    eventType: row.event_type as LogEventType,
    taskInstanceId: (row.task_instance_id as string) ?? null,
    templateId: (row.template_id as string) ?? null,
    timerSessionId: (row.timer_session_id as string) ?? null,
    actor: row.actor as LogEvent['actor'],
    payload: row.payload ? (JSON.parse(row.payload as string) as Record<string, unknown>) : null,
    createdAt: row.created_at as string,
  };
}

/** Chronological read (oldest first). Filters are AND-combined. */
export async function getLogEvents(
  db: SQLiteDatabase,
  filters: LogFilters = {}
): Promise<LogEvent[]> {
  const where: string[] = [];
  const params: SQLiteBindValue[] = [];

  if (filters.day) {
    // Match on the device-local calendar day of the event, using the
    // offset captured at event time (DST/travel safe). SQLite modifiers
    // need an explicit sign, e.g. '+330 minutes' / '-300 minutes'.
    where.push(
      `date(ts_utc, ((CASE WHEN ts_offset_min >= 0 THEN '+' ELSE '-' END) || abs(ts_offset_min) || ' minutes')) = ?`
    );
    params.push(filters.day);
  }
  if (filters.taskInstanceId) {
    where.push('task_instance_id = ?');
    params.push(filters.taskInstanceId);
  }
  if (filters.templateId) {
    where.push('template_id = ?');
    params.push(filters.templateId);
  }
  if (filters.eventTypes && filters.eventTypes.length > 0) {
    where.push(`event_type IN (${filters.eventTypes.map(() => '?').join(',')})`);
    params.push(...filters.eventTypes);
  }

  const sql =
    `SELECT * FROM log_events` +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY ts_utc ASC, id ASC` +
    (filters.limit ? ` LIMIT ${Math.floor(filters.limit)}` : '');

  const rows = await db.getAllAsync<Record<string, unknown>>(sql, ...params);
  return rows.map(rowToEvent);
}

/** Count events of given types since a UTC instant — used by streak/milestone logic. */
export async function countEventsSince(
  db: SQLiteDatabase,
  eventTypes: LogEventType[],
  sinceUtcIso: string
): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM log_events
     WHERE event_type IN (${eventTypes.map(() => '?').join(',')}) AND ts_utc >= ?`,
    ...eventTypes,
    sinceUtcIso
  );
  return row?.n ?? 0;
}
