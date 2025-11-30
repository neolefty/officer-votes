import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema.js';

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

async function createDb() {
  if (tursoUrl) {
    return drizzleLibsql(createClient({ url: tursoUrl, authToken: tursoToken }), { schema });
  } else {
    const { default: Database } = await import('better-sqlite3');
    const { drizzle: drizzleSqlite } = await import('drizzle-orm/better-sqlite3');
    const sqlite = new Database(process.env.DATABASE_URL || 'election.db');
    sqlite.pragma('journal_mode = WAL');
    return drizzleSqlite(sqlite, { schema });
  }
}

export const db = await createDb();
export { schema };
