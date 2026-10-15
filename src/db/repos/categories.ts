import type { SQLiteDatabase } from 'expo-sqlite';
import type { Category } from '../types';
import { logEvent } from '../log';
import { newId } from '../ids';
import { nowUtcIso } from '../time';
import { CATEGORY_TOKENS } from '../../theme/tokens';

function rowToCategory(row: Record<string, unknown>): Category {
  return {
    id: row.id as string,
    name: row.name as string,
    colorToken: row.color_token as string,
    rotationEnabled: (row.rotation_enabled as number) === 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function listCategories(db: SQLiteDatabase): Promise<Category[]> {
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM categories ORDER BY created_at ASC, name ASC'
  );
  return rows.map(rowToCategory);
}

export interface NewCategory {
  name: string;
  colorToken: string;
  rotationEnabled?: boolean;
}

export async function createCategory(
  db: SQLiteDatabase,
  input: NewCategory
): Promise<Category> {
  const name = input.name.trim();
  if (!name) throw new Error('Category name must not be empty.');
  if (!(CATEGORY_TOKENS as readonly string[]).includes(input.colorToken)) {
    throw new Error(`Invalid color token "${input.colorToken}".`);
  }
  const id = newId('cat');
  const now = nowUtcIso();
  await db.runAsync(
    `INSERT INTO categories (id, name, color_token, rotation_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    name,
    input.colorToken,
    input.rotationEnabled ? 1 : 0,
    now,
    now
  );
  await logEvent(db, {
    eventType: 'created',
    actor: 'user',
    payload: { name },
  });
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM categories WHERE id = ?',
    id
  );
  if (!row) throw new Error('Category insert failed.');
  return rowToCategory(row);
}

export interface CategoryPatch {
  name?: string;
  colorToken?: string;
  rotationEnabled?: boolean;
}

export async function updateCategory(
  db: SQLiteDatabase,
  id: string,
  patch: CategoryPatch
): Promise<void> {
  const sets: string[] = [];
  const params: Array<string | number> = [];

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error('Category name must not be empty.');
    sets.push('name = ?');
    params.push(name);
  }
  if (patch.colorToken !== undefined) {
    if (!(CATEGORY_TOKENS as readonly string[]).includes(patch.colorToken)) {
      throw new Error(`Invalid color token "${patch.colorToken}".`);
    }
    sets.push('color_token = ?');
    params.push(patch.colorToken);
  }
  if (patch.rotationEnabled !== undefined) {
    sets.push('rotation_enabled = ?');
    params.push(patch.rotationEnabled ? 1 : 0);
  }
  if (sets.length === 0) return;

  sets.push('updated_at = ?');
  params.push(nowUtcIso());
  params.push(id);

  const result = await db.runAsync(
    `UPDATE categories SET ${sets.join(', ')} WHERE id = ?`,
    ...params
  );
  if (result.changes === 0) throw new Error(`Category "${id}" not found.`);
  await logEvent(db, {
    eventType: 'edited',
    actor: 'user',
    payload: { patch },
  });
}
