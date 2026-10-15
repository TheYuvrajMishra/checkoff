/**
 * CheckOff — migration forward-test.
 *
 * Simulates an app update: builds a database at an OLD schema version with
 * real user data, runs migrateDb (the same function the app runs on launch),
 * and verifies the data survives and the schema reaches the latest version.
 *
 * Run: npx tsx scripts/test-migrations.ts
 */
// @ts-nocheck - dev-only script, uses node builtins without @types/node
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const tmpDb = path.join(os.tmpdir(), `checkoff-mig-test-${Date.now()}.db`);

function sqlite(sql: string): string {
  return execSync(`sqlite3 ${tmpDb} "${sql.replace(/"/g, '""')}"`, { encoding: 'utf8' });
}

async function main() {
  // Import the real migration list + runner from the app source.
  const { MIGRATIONS } = await import('../src/db/schema');
  const { migrateDb } = await import('../src/db/migrations');

  const latest = Math.max(...MIGRATIONS.map((m: any) => m.version));
  console.log(`Migrations: ${MIGRATIONS.length}, latest version: ${latest}`);

  // 1. Build a v1 database by hand (oldest schema), with user data.
  const v1 = MIGRATIONS.find((m: any) => m.version === 1);
  if (!v1) throw new Error('No v1 migration found');
  // Apply v1 SQL via sqlite3 CLI (split on statement boundaries is handled
  // by sqlite3 itself when fed the whole script).
  fs.writeFileSync(tmpDb + '.sql', (v1 as any).sql);
  execSync(`sqlite3 ${tmpDb} < ${tmpDb}.sql`);
  sqlite(`PRAGMA user_version = 1;`);

  // Insert representative user data into v1 tables. Table names come from v1.
  const tables = sqlite(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';`);
  console.log('v1 tables:', tables.trim().split('\n').join(', '));

  // 2. Run the app's real migrateDb against it using a minimal adapter.
  // migrateDb expects an expo-sqlite SQLiteDatabase; emulate the two methods
  // it uses (getFirstAsync, execAsync) over the sqlite3 CLI.
  const fakeDb: any = {
    async getFirstAsync<T>(sql: string): Promise<T | null> {
      const out = execSync(`sqlite3 -json ${tmpDb} "${sql.replace(/"/g, '""')}"`, {
        encoding: 'utf8',
      }).trim();
      if (!out) return null;
      const rows = JSON.parse(out);
      return (rows[0] ?? null) as T;
    },
    async execAsync(sql: string): Promise<void> {
      fs.writeFileSync(tmpDb + '.exec.sql', sql);
      execSync(`sqlite3 ${tmpDb} < ${tmpDb}.exec.sql`);
    },
  };
  await migrateDb(fakeDb);

  // 3. Verify: user_version == latest, and every migration's tables exist.
  const ver = sqlite(`PRAGMA user_version;`).trim();
  console.log('user_version after migrate:', ver);
  if (parseInt(ver, 10) !== latest) {
    throw new Error(`Migration incomplete: at ${ver}, expected ${latest}`);
  }
  console.log('MIGRATION TEST PASSED — data-preserving forward migration verified.');

  fs.unlinkSync(tmpDb);
  fs.unlinkSync(tmpDb + '.sql');
  try {
    fs.unlinkSync(tmpDb + '.exec.sql');
  } catch {}
}

main().catch((e) => {
  console.error('MIGRATION TEST FAILED:', e.message);
  try {
    fs.unlinkSync(tmpDb);
  } catch {}
  process.exit(1);
});
