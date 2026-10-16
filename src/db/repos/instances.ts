import type { SQLiteDatabase } from 'expo-sqlite';
import type { EventActor, InstanceStatus, TaskInstance, TaskPriority } from '../types';
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
    priority: (row.priority as TaskPriority) ?? 'medium',
    status: row.status as InstanceStatus,
    deleted: (row.deleted as number) === 1,
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
  priority?: TaskPriority;
  skillId?: string | null;
}

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high'];

function validatePriority(p: TaskPriority | undefined | null): TaskPriority {
  if (p === undefined || p === null) return 'medium';
  if (!PRIORITIES.includes(p)) throw new Error('priority must be low, medium or high.');
  return p;
}

export async function instancesForDate(
  db: SQLiteDatabase,
  date: string
): Promise<TaskInstanceEx[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM task_instances WHERE date = ? AND deleted = 0
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
  const priority = validatePriority(input.priority);
  await db.runAsync(
    `INSERT INTO task_instances
       (id, template_id, date, title, category_id, duration_min, alarm_time,
        is_ritual, priority, status, skill_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    id,
    input.templateId ?? null,
    input.date,
    title,
    input.categoryId ?? null,
    durationMin,
    input.alarmTime ?? null,
    input.isRitual ? 1 : 0,
    priority,
    input.skillId ?? null,
    now,
    now
  );
  await logEvent(db, {
    eventType: 'created',
    actor: 'user',
    taskInstanceId: id,
    payload: { title, date: input.date, priority },
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

export interface InstancePatch {
  title?: string;
  categoryId?: string | null;
  durationMin?: number;
  alarmTime?: string | null;
  priority?: TaskPriority;
}

const ALARM_RE = /^(\d{2}):(\d{2})$/;

function validateAlarmTime(alarmTime: string | null | undefined): string | null {
  if (alarmTime === undefined || alarmTime === null) return null;
  const m = ALARM_RE.exec(alarmTime);
  if (!m) throw new Error('alarmTime must match HH:MM (24h).');
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) throw new Error('alarmTime out of range.');
  return alarmTime;
}

/** Edit an instance's fields in place. Logged as 'edited'. */
export async function updateInstance(
  db: SQLiteDatabase,
  id: string,
  patch: InstancePatch
): Promise<void> {
  const current = await getInstance(db, id);
  if (!current) throw new Error(`Instance "${id}" not found.`);
  if (current.deleted) throw new Error(`Instance "${id}" is deleted.`);

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new Error('Instance title must not be empty.');
    sets.push('title = ?');
    params.push(title);
  }
  if (patch.categoryId !== undefined) {
    if (patch.categoryId) {
      const cat = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM categories WHERE id = ?',
        patch.categoryId
      );
      if (!cat) throw new Error(`Category "${patch.categoryId}" not found.`);
    }
    sets.push('category_id = ?');
    params.push(patch.categoryId ?? null);
  }
  if (patch.durationMin !== undefined) {
    if (!Number.isInteger(patch.durationMin) || patch.durationMin < 1 || patch.durationMin > 480) {
      throw new Error('durationMin must be an integer between 1 and 480.');
    }
    sets.push('duration_min = ?');
    params.push(patch.durationMin);
  }
  if (patch.alarmTime !== undefined) {
    sets.push('alarm_time = ?');
    params.push(validateAlarmTime(patch.alarmTime));
  }
  if (patch.priority !== undefined) {
    sets.push('priority = ?');
    params.push(validatePriority(patch.priority));
  }
  if (sets.length === 0) return;

  sets.push('updated_at = ?');
  params.push(nowUtcIso());
  params.push(id);

  const result = await db.runAsync(
    `UPDATE task_instances SET ${sets.join(', ')} WHERE id = ? AND deleted = 0`,
    ...params
  );
  if (result.changes === 0) throw new Error(`Instance "${id}" not found.`);
  await logEvent(db, {
    eventType: 'edited',
    actor: 'user',
    taskInstanceId: id,
    templateId: current.templateId,
    payload: { patch },
  });
}

/** Duplicate an instance as a fresh pending copy. Logged as 'created'. */
export async function duplicateInstance(
  db: SQLiteDatabase,
  id: string
): Promise<TaskInstanceEx> {
  const current = await getInstance(db, id);
  if (!current) throw new Error(`Instance "${id}" not found.`);
  if (current.deleted) throw new Error(`Instance "${id}" is deleted.`);
  const copy = await createInstance(db, {
    templateId: null, // a duplicate is a standalone copy
    date: current.date,
    title: `${current.title} (copy)`,
    categoryId: current.categoryId,
    durationMin: current.durationMin,
    alarmTime: current.alarmTime,
    isRitual: current.isRitual,
    priority: current.priority,
  });
  await logEvent(db, {
    eventType: 'created',
    actor: 'user',
    taskInstanceId: copy.id,
    payload: { duplicatedFrom: id },
  });
  return copy;
}

/** Soft delete: flips the deleted flag, keeps the row. Logged as 'deleted'. */
export async function softDeleteInstance(
  db: SQLiteDatabase,
  id: string
): Promise<void> {
  const current = await getInstance(db, id);
  if (!current) throw new Error(`Instance "${id}" not found.`);
  if (current.deleted) return;
  await db.runAsync(
    'UPDATE task_instances SET deleted = 1, updated_at = ? WHERE id = ?',
    nowUtcIso(),
    id
  );
  await logEvent(db, {
    eventType: 'deleted',
    actor: 'user',
    taskInstanceId: id,
    templateId: current.templateId,
    payload: { title: current.title, date: current.date },
  });
}

/** Move an instance to another day. Logged as 'scheduled' with from/to. */
export async function rescheduleInstance(
  db: SQLiteDatabase,
  id: string,
  date: string
): Promise<void> {
  const current = await getInstance(db, id);
  if (!current) throw new Error(`Instance "${id}" not found.`);
  if (current.deleted) throw new Error(`Instance "${id}" is deleted.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must be YYYY-MM-DD.');
  if (date === current.date) return;
  await db.runAsync(
    'UPDATE task_instances SET date = ?, updated_at = ? WHERE id = ? AND deleted = 0',
    date,
    nowUtcIso(),
    id
  );
  await logEvent(db, {
    eventType: 'scheduled',
    actor: 'user',
    taskInstanceId: id,
    templateId: current.templateId,
    payload: { from: current.date, to: date, alarmTime: current.alarmTime },
  });
}
