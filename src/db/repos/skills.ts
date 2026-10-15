import type { SQLiteDatabase } from 'expo-sqlite';
import type { Skill } from '../types';
import { logEvent } from '../log';
import { newId } from '../ids';
import { nowUtcIso } from '../time';

function rowToSkill(row: Record<string, unknown>): Skill {
  return {
    id: row.id as string,
    categoryId: row.category_id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
  };
}

export async function listSkills(
  db: SQLiteDatabase,
  categoryId?: string
): Promise<Skill[]> {
  const rows = categoryId
    ? await db.getAllAsync<Record<string, unknown>>(
        'SELECT * FROM skills WHERE category_id = ? ORDER BY created_at ASC, name ASC',
        categoryId
      )
    : await db.getAllAsync<Record<string, unknown>>(
        'SELECT * FROM skills ORDER BY created_at ASC, name ASC'
      );
  return rows.map(rowToSkill);
}

export async function createSkill(
  db: SQLiteDatabase,
  input: { categoryId: string; name: string }
): Promise<Skill> {
  const name = input.name.trim();
  if (!name) throw new Error('Skill name must not be empty.');
  const cat = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM categories WHERE id = ?',
    input.categoryId
  );
  if (!cat) throw new Error(`Category "${input.categoryId}" not found.`);

  const id = newId('skl');
  const now = nowUtcIso();
  await db.runAsync(
    'INSERT INTO skills (id, category_id, name, created_at) VALUES (?, ?, ?, ?)',
    id,
    input.categoryId,
    name,
    now
  );
  await logEvent(db, {
    eventType: 'created',
    actor: 'user',
    payload: { name, categoryId: input.categoryId },
  });
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM skills WHERE id = ?',
    id
  );
  if (!row) throw new Error('Skill insert failed.');
  return rowToSkill(row);
}

/**
 * Latest UTC timestamp at which the skill was practiced:
 * (a) a task instance linked to this skill was completed, or
 * (b) a timer session ended carrying this skill id in its payload.
 * Returns null when never practiced.
 */
export async function lastPracticedAt(
  db: SQLiteDatabase,
  skillId: string
): Promise<string | null> {
  const row = await db.getFirstAsync<{ last_ts: string | null }>(
    `SELECT MAX(ts) AS last_ts FROM (
       SELECT l.ts_utc AS ts
       FROM log_events l
       JOIN task_instances i ON i.id = l.task_instance_id
       WHERE l.event_type = 'completed' AND i.skill_id = ?
       UNION ALL
       SELECT l.ts_utc AS ts
       FROM log_events l
       WHERE l.event_type = 'timer_session_ended'
         AND json_extract(l.payload, '$.skillId') = ?
     )`,
    skillId,
    skillId
  );
  return row?.last_ts ?? null;
}
