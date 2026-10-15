import type { SQLiteDatabase } from 'expo-sqlite';
import type { EventActor, InstanceStatus, TaskInstance } from '../types';
import { logEvent } from '../log';
import { newId } from '../ids';
import { nowUtcIso } from '../time';

/**
 * TaskInstance plus the v2 skill link. Structural subtype of TaskInstance,
 * so it is assignable wherever TaskInstance[] is expected (types.ts is
 * Phase-1 stable and intentionally not extended).
 */
export interface TaskInstanceEx extends TaskInstance {
  skillId: string | null;
}

function rowToInstance(row: Record<string, unknown>): TaskInstanceEx {
  return {
    id: row.id as string,
    templateId: (row.template_id as string) ?? null,
    date: row.date as string,
    title: row.title as string,
    categoryId: (row.category_id as string) ?? null,
    durationMin: row.duration_min as number,
    alarmTime: (row.alarm_time as string) ?? null,
    isRitual: (row.is_ritual as number) === 1,
    status: row.status as InstanceStatus,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    skillId: (row.skill_id as string) ?? null,
  };
}

export interface NewInstance {
  templateId?: string | null;
  date: string;
  title: string;
  categoryId?: string | null;
  durationMin?: number;
  alarmTime?: string | null;
  isRitual?: boolean;
  skillId?: string | null;
}

export async function instancesForDate(
  db: SQLiteDatabase,
  date: string
): Promise<TaskInstanceEx[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM task_instances WHERE date = ?
     ORDER BY alarm_time IS NULL, alarm_time ASC, created_at ASC`,
    date
  );
  return rows.map(rowToInstance);
}

export async function getInstance(
  db: SQLiteDatabase,
  id: string
): Promise<TaskInstanceEx | null> {
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM task_instances WHERE id = ?',
    id
  );
  return row ? rowToInstance(row) : null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createInstance(
  db: SQLiteDatabase,
  input: NewInstance
): Promise<TaskInstanceEx> {
  const title = input.title.trim();
  if (!title) throw new Error('Instance title must not be empty.');
  if (!DATE_RE.test(input.date)) throw new Error('date must be YYYY-MM-DD.');
  const durationMin = input.durationMin ?? 30;
  if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 480) {
    throw new Error('durationMin must be an integer between 1 and 480.');
  }

  const id = newId('ins');
  const now = nowUtcIso();
  await db.runAsync(
    `INSERT INTO task_instances
       (id, template_id, date, title, category_id, duration_min, alarm_time,
        is_ritual, status, skill_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    id,
    input.templateId ?? null,
    input.date,
    title,
    input.categoryId ?? null,
    durationMin,
    input.alarmTime ?? null,
    input.isRitual ? 1 : 0,
    input.skillId ?? null,
    now,
    now
  );
  await logEvent(db, {
    eventType: 'created',
    actor: 'user',
    taskInstanceId: id,
    payload: { title, date: input.date },
  });
  await logEvent(db, {
    eventType: 'scheduled',
    actor: 'user',
    taskInstanceId: id,
    payload: { date: input.date, alarmTime: input.alarmTime ?? null },
  });
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM task_instances WHERE id = ?',
    id
  );
  if (!row) throw new Error('Instance insert failed.');
  return rowToInstance(row);
}

const STATUS_EVENT: Record<InstanceStatus, 'completed' | 'unchecked' | 'skipped' | 'missed'> = {
  done: 'completed',
  pending: 'unchecked',
  skipped: 'skipped',
  missed: 'missed',
};

export async function setInstanceStatus(
  db: SQLiteDatabase,
  id: string,
  status: InstanceStatus,
  actor: EventActor,
  note?: string
): Promise<void> {
  const current = await getInstance(db, id);
  if (!current) throw new Error(`Instance "${id}" not found.`);
  await db.runAsync(
    'UPDATE task_instances SET status = ?, updated_at = ? WHERE id = ?',
    status,
    nowUtcIso(),
    id
  );
  await logEvent(db, {
    eventType: STATUS_EVENT[status],
    actor,
    taskInstanceId: id,
    payload: { from: current.status, to: status, note: note ?? null },
  });
}
