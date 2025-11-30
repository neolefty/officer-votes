import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema.js';

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

export const db = tursoUrl
  ? drizzleLibsql(createClient({ url: tursoUrl, authToken: tursoToken }), { schema })
  : (() => {
      const Database = require('better-sqlite3');
      const sqlite = new Database(process.env.DATABASE_URL || 'election.db');
      sqlite.pragma('journal_mode = WAL');
      return drizzleSqlite(sqlite, { schema });
    })();

export { schema };
