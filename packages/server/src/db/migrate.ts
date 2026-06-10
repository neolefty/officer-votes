import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { runMigrations } from './migrations.js';
import type { MigrationDb } from './migrations.js';

// CLI entry point (`pnpm db:migrate`, and the dev/start scripts): opens its
// own connection and applies the migrations in migrations.ts.
const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

let db: MigrationDb;
let cleanup: () => void = () => {};

if (tursoUrl) {
  db = drizzleLibsql(createClient({ url: tursoUrl, authToken: tursoToken }));
} else {
  const { default: Database } = await import('better-sqlite3');
  const { drizzle: drizzleSqlite } = await import('drizzle-orm/better-sqlite3');
  const sqlite = new Database(process.env.DATABASE_URL || 'election.db');
  db = drizzleSqlite(sqlite);
  cleanup = () => sqlite.close();
}

await runMigrations(db);
cleanup();
