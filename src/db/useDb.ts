import { useSQLiteContext } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

/** Typed handle to the CheckOff database. DB is the source of truth. */
export function useDb(): SQLiteDatabase {
  return useSQLiteContext();
}
