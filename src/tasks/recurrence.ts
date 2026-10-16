import type { SQLiteDatabase } from 'expo-sqlite';
import { logEvent } from '../db/log';
import { newId } from '../db/ids';
import { nowUtcIso } from '../db/time';
import { listTemplates } from '../db/repos/templates';
import type { TaskTemplate } from '../db/types';

/** Local weekday index (0=Sun..6=Sat) for a YYYY-MM-DD date string. */
function weekdayIndexOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function occursOn(template: TaskTemplate, date: string): boolean {
  switch (template.recurrence) {
    case 'daily':
      return true;
    case 'weekdays': {
      const wd = weekdayIndexOf(date);
      return wd >= 1 && wd <= 5;
    }
    case 'custom':
      return (template.customDays ?? []).includes(weekdayIndexOf(date));
    case 'once':
      return template.targetDate === date;
    default:
      return false;
  }
}

/**
 * Generate today's (or any date's) instances from enabled templates.
 * Idempotent: the UNIQUE(template_id, date) constraint plus INSERT OR IGNORE
 * means already-scheduled templates are skipped silently.
 */
export async function ensureInstancesForDate(
  db: SQLiteDatabase,
  date: string
): Promise<void> {
  const templates = await listTemplates(db, { enabledOnly: true });
  for (const t of templates) {
    if (!occursOn(t, date)) continue;
    const id = newId('ins');
    const now = nowUtcIso();
    const result = await db.runAsync(
      `INSERT OR IGNORE INTO task_instances
         (id, template_id, date, title, category_id, duration_min, alarm_time,
          is_ritual, priority, status, skill_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
      id,
      t.id,
      date,
      t.title,
      t.categoryId,
      t.durationMin,
      t.alarmTime,
      t.isRitual ? 1 : 0,
      t.priority ?? 'medium',
      now,
      now
    );
    if (result.changes > 0) {
      await logEvent(db, {
        eventType: 'scheduled',
        actor: 'system',
        taskInstanceId: id,
        templateId: t.id,
        payload: { templateId: t.id, date, alarmTime: t.alarmTime },
      });
    }
  }
}

/**
 * Auto-miss anything still pending on days before `today`.
 * Idempotent across runs (only pending rows are touched).
 */
export async function markPastDueMissed(
  db: SQLiteDatabase,
  today: string
): Promise<void> {
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM task_instances WHERE date < ? AND status = 'pending' AND deleted = 0`,
    today
  );
  for (const row of rows) {
    const now = nowUtcIso();
    const result = await db.runAsync(
      `UPDATE task_instances SET status = 'missed', updated_at = ?
       WHERE id = ? AND status = 'pending'`,
      now,
      row.id
    );
    if (result.changes > 0) {
      await logEvent(db, {
        eventType: 'missed',
        actor: 'auto',
        taskInstanceId: row.id,
        payload: { from: 'pending', to: 'missed', autoMissed: true },
      });
    }
  }
}
