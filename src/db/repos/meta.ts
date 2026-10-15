import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Tiny key-value store for app settings/flags. STABLE — coordinator-owned.
 * Self-creates its table (operational state, not domain data).
 */

export const META_KEYS = {
  onboarded: 'onboarded',
  graceMin: 'grace_min',
  hapticsEnabled: 'haptics_enabled',
  hapticIntensity: 'haptic_intensity',
  theme: 'theme',
  snoozeMin: 'snooze_min',
  rotationDate: 'rotation_date',
  rotationSkillId: 'rotation_skill_id',
} as const;

async function ensureMetaTable(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`
  );
}

export async function getMeta(db: SQLiteDatabase, key: string): Promise<string | null> {
  await ensureMetaTable(db);
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM meta WHERE key = ?',
    key
  );
  return row?.value ?? null;
}

export async function setMeta(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await ensureMetaTable(db);
  await db.runAsync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value
  );
}
