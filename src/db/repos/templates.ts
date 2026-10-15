import type { SQLiteDatabase } from 'expo-sqlite';
import type { Recurrence, TaskTemplate } from '../types';
import { logEvent } from '../log';
import { newId } from '../ids';
import { nowUtcIso } from '../time';

export interface NewTemplate {
  title: string;
  categoryId?: string | null;
  durationMin?: number;
  recurrence: Recurrence;
  customDays?: number[];
  targetDate?: string | null;
  alarmTime?: string | null;
  isRitual?: boolean;
}

function rowToTemplate(row: Record<string, unknown>): TaskTemplate {
  let customDays: number[] | null = null;
  if (row.custom_days) {
    try {
      const parsed = JSON.parse(row.custom_days as string) as unknown;
      customDays = Array.isArray(parsed) ? (parsed as number[]) : null;
    } catch {
      customDays = null;
    }
  }
  return {
    id: row.id as string,
    title: row.title as string,
    categoryId: (row.category_id as string) ?? null,
    durationMin: row.duration_min as number,
    recurrence: row.recurrence as Recurrence,
    customDays,
    targetDate: (row.target_date as string) ?? null,
    alarmTime: (row.alarm_time as string) ?? null,
    isRitual: (row.is_ritual as number) === 1,
    enabled: (row.enabled as number) === 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

const ALARM_RE = /^(\d{2}):(\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateAlarmTime(alarmTime: string | null | undefined): string | null {
  if (alarmTime === undefined || alarmTime === null) return null;
  const m = ALARM_RE.exec(alarmTime);
  if (!m) throw new Error('alarmTime must match HH:MM (24h).');
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) throw new Error('alarmTime out of range.');
  return alarmTime;
}

export async function listTemplates(
  db: SQLiteDatabase,
  opts: { enabledOnly?: boolean } = {}
): Promise<TaskTemplate[]> {
  const rows = opts.enabledOnly
    ? await db.getAllAsync<Record<string, unknown>>(
        'SELECT * FROM task_templates WHERE enabled = 1 ORDER BY created_at ASC'
      )
    : await db.getAllAsync<Record<string, unknown>>(
        'SELECT * FROM task_templates ORDER BY created_at ASC'
      );
  return rows.map(rowToTemplate);
}

export async function createTemplate(
  db: SQLiteDatabase,
  input: NewTemplate
): Promise<TaskTemplate> {
  const title = input.title.trim();
  if (!title) throw new Error('Task title must not be empty.');

  const durationMin = input.durationMin ?? 30;
  if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 480) {
    throw new Error('durationMin must be an integer between 1 and 480.');
  }

  let customDays: number[] | null = null;
  if (input.recurrence === 'custom') {
    const days = input.customDays ?? [];
    if (days.length === 0) throw new Error('custom recurrence needs at least one day.');
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new Error('customDays entries must be 0..6 (Sun..Sat).');
    }
    customDays = [...days].sort((a, b) => a - b);
  }

  let targetDate: string | null = null;
  if (input.recurrence === 'once') {
    if (!input.targetDate || !DATE_RE.test(input.targetDate)) {
      throw new Error('once recurrence requires a targetDate YYYY-MM-DD.');
    }
    targetDate = input.targetDate;
  }

  const alarmTime = validateAlarmTime(input.alarmTime ?? null);

  const categoryId = input.categoryId ?? null;
  if (categoryId) {
    const cat = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM categories WHERE id = ?',
      categoryId
    );
    if (!cat) throw new Error(`Category "${categoryId}" not found.`);
  }

  const id = newId('tpl');
  const now = nowUtcIso();
  await db.runAsync(
    `INSERT INTO task_templates
       (id, title, category_id, duration_min, recurrence, custom_days, target_date,
        alarm_time, is_ritual, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    id,
    title,
    categoryId,
    durationMin,
    input.recurrence,
    customDays ? JSON.stringify(customDays) : null,
    targetDate,
    alarmTime,
    input.isRitual ? 1 : 0,
    now,
    now
  );
  await logEvent(db, {
    eventType: 'created',
    actor: 'user',
    templateId: id,
    payload: {
      title,
      categoryId,
      durationMin,
      recurrence: input.recurrence,
      customDays,
      targetDate,
      alarmTime,
      isRitual: !!input.isRitual,
    },
  });
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM task_templates WHERE id = ?',
    id
  );
  if (!row) throw new Error('Template insert failed.');
  return rowToTemplate(row);
}

export type TemplatePatch = Partial<NewTemplate & { enabled: boolean }>;

export async function updateTemplate(
  db: SQLiteDatabase,
  id: string,
  patch: TemplatePatch
): Promise<void> {
  const sets: string[] = [];
  const params: Array<string | number | null> = [];

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) throw new Error('Task title must not be empty.');
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
  if (patch.recurrence !== undefined) {
    sets.push('recurrence = ?');
    params.push(patch.recurrence);
    if (patch.recurrence === 'custom') {
      const days = patch.customDays ?? [];
      if (days.length === 0) throw new Error('custom recurrence needs at least one day.');
      if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
        throw new Error('customDays entries must be 0..6 (Sun..Sat).');
      }
      sets.push('custom_days = ?');
      params.push(JSON.stringify([...days].sort((a, b) => a - b)));
    } else if (patch.customDays !== undefined) {
      sets.push('custom_days = ?');
      params.push(JSON.stringify(patch.customDays));
    }
    if (patch.recurrence === 'once') {
      if (!patch.targetDate || !DATE_RE.test(patch.targetDate)) {
        throw new Error('once recurrence requires a targetDate YYYY-MM-DD.');
      }
      sets.push('target_date = ?');
      params.push(patch.targetDate);
    } else if (patch.targetDate !== undefined) {
      sets.push('target_date = ?');
      params.push(patch.targetDate);
    }
  } else {
    if (patch.customDays !== undefined) {
      sets.push('custom_days = ?');
      params.push(JSON.stringify(patch.customDays));
    }
    if (patch.targetDate !== undefined) {
      sets.push('target_date = ?');
      params.push(patch.targetDate ?? null);
    }
  }
  if (patch.alarmTime !== undefined) {
    sets.push('alarm_time = ?');
    params.push(validateAlarmTime(patch.alarmTime));
  }
  if (patch.isRitual !== undefined) {
    sets.push('is_ritual = ?');
    params.push(patch.isRitual ? 1 : 0);
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(patch.enabled ? 1 : 0);
  }
  if (sets.length === 0) return;

  sets.push('updated_at = ?');
  params.push(nowUtcIso());
  params.push(id);

  const result = await db.runAsync(
    `UPDATE task_templates SET ${sets.join(', ')} WHERE id = ?`,
    ...params
  );
  if (result.changes === 0) throw new Error(`Template "${id}" not found.`);
  await logEvent(db, {
    eventType: 'edited',
    actor: 'user',
    templateId: id,
    payload: { patch },
  });
}

export async function setTemplateEnabled(
  db: SQLiteDatabase,
  id: string,
  enabled: boolean
): Promise<void> {
  const result = await db.runAsync(
    'UPDATE task_templates SET enabled = ?, updated_at = ? WHERE id = ?',
    enabled ? 1 : 0,
    nowUtcIso(),
    id
  );
  if (result.changes === 0) throw new Error(`Template "${id}" not found.`);
  await logEvent(db, {
    eventType: 'edited',
    actor: 'user',
    templateId: id,
    payload: { enabled },
  });
}
