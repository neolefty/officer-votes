import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

let db: ReturnType<typeof drizzleSqlite> | ReturnType<typeof drizzleLibsql>;
let cleanup: () => void = () => {};

if (tursoUrl) {
  db = drizzleLibsql(createClient({ url: tursoUrl, authToken: tursoToken }));
} else {
  const Database = require('better-sqlite3');
  const sqlite = new Database(process.env.DATABASE_URL || 'election.db');
  db = drizzleSqlite(sqlite);
  cleanup = () => sqlite.close();
}

// Create tables directly (simpler than migrations for now)
db.run(sql`
  CREATE TABLE IF NOT EXISTS elections (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )
`);

db.run(sql`
  CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    election_id TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('teller', 'voter')),
    token TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )
`);

db.run(sql`
  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    election_id TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    office TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('voting', 'revealed', 'cancelled')),
    disclosure_level TEXT CHECK (disclosure_level IN ('top', 'all', 'none')),
    created_at INTEGER NOT NULL
  )
`);

db.run(sql`
  CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    candidate_id TEXT
  )
`);

db.run(sql`
  CREATE TABLE IF NOT EXISTS vote_records (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    voted_at INTEGER NOT NULL
  )
`);

console.log('Database tables created successfully');
cleanup();
