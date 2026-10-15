import type { SQLiteDatabase } from 'expo-sqlite';
import { MIGRATIONS } from './schema';

/**
 * Runs pending migrations in version order, tracked via PRAGMA user_version.
 * Safe to call on every launch — already-applied migrations are skipped.
 */
export async function migrateDb(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version
  );

  for (const m of pending) {
    // execAsync runs the whole migration script as one batch.
    await db.execAsync(m.sql);
    await db.execAsync(`PRAGMA user_version = ${m.version};`);
  }
}
