/**
 * CheckOff — analytics read helpers (Phase 4).
 * Raw SQL against the v1 schema (+ v2 `skill_id`, which is selected
 * defensively: every instance SELECT lists explicit columns and omits
 * skill_id so queries cannot crash on a pre-v2 database).
 * All helpers are pure reads; they never throw on empty tables.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import type { LogEvent, TaskInstance, TimerSession } from '../db/types';

/** Explicit column list for task_instances — priority/deleted added in v3,
 *  skill_id in v2. Every SELECT lists explicit columns so queries cannot
 *  crash on an older database. */
const INSTANCE_COLS = [
  'id',
  'template_id',
  'date',
  'title',
  'category_id',
  'duration_min',
  'alarm_time',
  'is_ritual',
  'priority',
  'status',
  'deleted',
  'created_at',
  'updated_at',
].join(', ');

function mapInstance(row: Record<string, unknown>): TaskInstance {
  return {
    id: row.id as string,
    templateId: (row.template_id as string) ?? null,
    date: row.date as string,
    title: row.title as string,
    categoryId: (row.category_id as string) ?? null,
    durationMin: Number(row.duration_min ?? 0),
    alarmTime: (row.alarm_time as string) ?? null,
    isRitual: (row.is_ritual as number) === 1,
    priority: (row.priority as TaskInstance['priority']) ?? 'medium',
    status: row.status as TaskInstance['status'],
    deleted: (row.deleted as number) === 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapSession(row: Record<string, unknown>): TimerSession {
  return {
    id: row.id as string,
    taskInstanceId: (row.task_instance_id as string) ?? null,
    mode: row.mode as TimerSession['mode'],
    plannedMin: row.planned_min == null ? null : Number(row.planned_min),
    startedAtUtc: row.started_at_utc as string,
    endedAtUtc: (row.ended_at_utc as string) ?? null,
    createdAt: row.created_at as string,
  };
}

/** All instances in a local-date range, ordered by day then alarm time. */
export async function instancesInRange(
  db: SQLiteDatabase,
  fromDate: string,
  toDate: string
): Promise<TaskInstance[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT ${INSTANCE_COLS} FROM task_instances
     WHERE date BETWEEN ? AND ? AND deleted = 0
     ORDER BY date ASC, alarm_time ASC`,
    fromDate,
    toDate
  );
  return rows.map(mapInstance);
}

export interface DaySummary {
  done: number;
  total: number;
  ritualsDone: number;
  ritualsTotal: number;
}

/** One-day completion snapshot. */
export async function daySummary(db: SQLiteDatabase, date: string): Promise<DaySummary> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
            SUM(is_ritual) AS rituals_total,
            SUM(CASE WHEN is_ritual = 1 AND status = 'done' THEN 1 ELSE 0 END) AS rituals_done
     FROM task_instances WHERE date = ? AND deleted = 0`,
    date
  );
  return {
    done: Number(row?.done ?? 0),
    total: Number(row?.total ?? 0),
    ritualsDone: Number(row?.rituals_done ?? 0),
    ritualsTotal: Number(row?.rituals_total ?? 0),
  };
}

export type MonthSummary = Record<string, { done: number; total: number }>;

/** Per-day done/total for a calendar month. `month` is 1..12. */
export async function monthSummary(
  db: SQLiteDatabase,
  year: number,
  month: number
): Promise<MonthSummary> {
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT date,
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
     FROM task_instances
     WHERE date LIKE ? AND deleted = 0
     GROUP BY date`,
    `${prefix}%`
  );
  const out: MonthSummary = {};
  for (const r of rows) {
    out[r.date as string] = {
      done: Number(r.done ?? 0),
      total: Number(r.total ?? 0),
    };
  }
  return out;
}

/** Timer sessions whose UTC start falls in [fromUtc, toUtc]. */
export async function sessionsInRange(
  db: SQLiteDatabase,
  fromUtc: string,
  toUtc: string
): Promise<TimerSession[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT id, task_instance_id, mode, planned_min, started_at_utc, ended_at_utc, created_at
     FROM timer_sessions
     WHERE started_at_utc >= ? AND started_at_utc <= ?
     ORDER BY started_at_utc ASC`,
    fromUtc,
    toUtc
  );
  return rows.map(mapSession);
}

export interface CompletedTimestamp {
  instanceId: string;
  tsUtc: string;
  /** Local day of the instance (not of the event). */
  date: string;
  tsOffsetMin: number;
}

/**
 * 'completed' log events for instances in the date range.
 * Multiple completions per instance are possible (unchecked, then completed);
 * consumers should take the earliest per instance.
 */
export async function completedTimestamps(
  db: SQLiteDatabase,
  fromDate: string,
  toDate: string
): Promise<CompletedTimestamp[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT e.task_instance_id AS instance_id, e.ts_utc AS ts_utc,
            i.date AS date, e.ts_offset_min AS ts_offset_min
     FROM log_events e
     JOIN task_instances i ON i.id = e.task_instance_id
     WHERE e.event_type = 'completed' AND i.date BETWEEN ? AND ?
     ORDER BY e.ts_utc ASC`,
    fromDate,
    toDate
  );
  return rows.map((r) => ({
    instanceId: r.instance_id as string,
    tsUtc: r.ts_utc as string,
    date: r.date as string,
    tsOffsetMin: Number(r.ts_offset_min ?? 0),
  }));
}

/** Skill id → display name. */
export async function skillNames(db: SQLiteDatabase): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT id, name FROM skills'
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.id as string] = r.name as string;
  return out;
}

/** Skill id → category id. */
export async function skillCategory(
  db: SQLiteDatabase
): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT id, category_id FROM skills'
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.id as string] = r.category_id as string;
  return out;
}

export interface CategoryMeta {
  name: string;
  colorToken: string;
}

/** Category id → display name. */
export async function categoryName(db: SQLiteDatabase): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT id, name FROM categories'
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.id as string] = r.name as string;
  return out;
}

/** Category id → name + color token (for dots/legends). */
export async function categoryMeta(
  db: SQLiteDatabase
): Promise<Record<string, CategoryMeta>> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT id, name, color_token FROM categories'
  );
  const out: Record<string, CategoryMeta> = {};
  for (const r of rows) {
    out[r.id as string] = {
      name: r.name as string,
      colorToken: r.color_token as string,
    };
  }
  return out;
}

/**
 * Resolve human titles for a batch of log events.
 * Returns id → title for every referenced instance and template id.
 */
export async function titlesForEvents(
  db: SQLiteDatabase,
  events: LogEvent[]
): Promise<Record<string, string>> {
  const instanceIds = [...new Set(events.map((e) => e.taskInstanceId).filter(Boolean))] as string[];
  const templateIds = [...new Set(events.map((e) => e.templateId).filter(Boolean))] as string[];
  const out: Record<string, string> = {};
  if (instanceIds.length > 0) {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT id, title FROM task_instances WHERE id IN (${instanceIds.map(() => '?').join(',')})`,
      ...instanceIds
    );
    for (const r of rows) out[r.id as string] = r.title as string;
  }
  if (templateIds.length > 0) {
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT id, title FROM task_templates WHERE id IN (${templateIds.map(() => '?').join(',')})`,
      ...templateIds
    );
    for (const r of rows) out[r.id as string] = r.title as string;
  }
  return out;
}

/** Local-day start as a UTC ISO string (uses the device's current offset). */
function localDayStartUtc(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0).toISOString();
}

/** Local-day end as a UTC ISO string (uses the device's current offset). */
function localDayEndUtc(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

/**
 * Minutes per category over a local-date range.
 * Source: actual timer-session minutes grouped by the session's instance
 * category, plus durationMin of done instances that have no completed session.
 */
export async function categoryMinutes(
  db: SQLiteDatabase,
  fromDate: string,
  toDate: string
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const add = (catId: string | null, min: number) => {
    if (!catId || min <= 0) return;
    out[catId] = (out[catId] ?? 0) + min;
  };

  const sessions = await db.getAllAsync<Record<string, unknown>>(
    `SELECT s.started_at_utc, s.ended_at_utc, i.category_id, s.task_instance_id
     FROM timer_sessions s
     LEFT JOIN task_instances i ON i.id = s.task_instance_id
     WHERE s.started_at_utc >= ? AND s.started_at_utc <= ?
       AND s.ended_at_utc IS NOT NULL`,
    localDayStartUtc(fromDate),
    localDayEndUtc(toDate)
  );
  const sessionsByInstance = new Set<string>();
  for (const s of sessions) {
    const start = new Date(s.started_at_utc as string).getTime();
    const end = new Date(s.ended_at_utc as string).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      add(s.category_id as string | null, (end - start) / 60000);
      if (s.task_instance_id) sessionsByInstance.add(s.task_instance_id as string);
    }
  }

  const done = await db.getAllAsync<Record<string, unknown>>(
    `SELECT id, category_id, duration_min FROM task_instances
     WHERE date BETWEEN ? AND ? AND status = 'done'`,
    fromDate,
    toDate
  );
  for (const d of done) {
    if (!sessionsByInstance.has(d.id as string)) {
      add(d.category_id as string | null, Number(d.duration_min ?? 0));
    }
  }
  return out;
}

/**
 * Minutes per skill over a UTC range, sourced from the `skillId` captured in
 * `timer_session_ended` log payloads (defensive: works without the v2
 * `task_instances.skill_id` column).
 */
export async function skillMinutes(
  db: SQLiteDatabase,
  fromUtc: string,
  toUtc: string
): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT json_extract(e.payload, '$.skillId') AS skill_id,
            s.started_at_utc AS started_at_utc,
            s.ended_at_utc AS ended_at_utc
     FROM log_events e
     LEFT JOIN timer_sessions s ON s.id = e.timer_session_id
     WHERE e.event_type = 'timer_session_ended'
       AND e.ts_utc >= ? AND e.ts_utc <= ?
       AND s.ended_at_utc IS NOT NULL`,
    fromUtc,
    toUtc
  );
  const out: Record<string, number> = {};
  for (const r of rows) {
    const skillId = r.skill_id as string | null;
    if (!skillId) continue;
    const start = new Date(r.started_at_utc as string).getTime();
    const end = new Date(r.ended_at_utc as string).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      out[skillId] = (out[skillId] ?? 0) + (end - start) / 60000;
    }
  }
  return out;
}
