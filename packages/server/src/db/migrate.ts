import { drizzle as drizzleLibsql } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';

const tursoUrl = process.env.TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;

let db: any;
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

// Create tables directly (simpler than migrations for now)
db.run(sql`
  CREATE TABLE IF NOT EXISTS elections (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    body_size INTEGER,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )
`);

// Add body_size column if it doesn't exist (for existing databases)
try {
  db.run(sql`ALTER TABLE elections ADD COLUMN body_size INTEGER`);
} catch (e) {
  // Column already exists, ignore
}

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
    status TEXT NOT NULL CHECK (status IN ('voting', 'closed', 'revealed', 'cancelled')),
    disclosure_level TEXT CHECK (disclosure_level IN ('top', 'top_no_count', 'all', 'none')),
    created_at INTEGER NOT NULL
  )
`);

// Migration: Update rounds table to add 'closed' status to CHECK constraint
// SQLite doesn't support ALTER CHECK, so we recreate the table
try {
  // Check if we need to migrate by trying to insert 'closed' status
  db.run(sql`
    CREATE TABLE IF NOT EXISTS rounds_new (
      id TEXT PRIMARY KEY,
      election_id TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
      office TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL CHECK (status IN ('voting', 'closed', 'revealed', 'cancelled')),
      disclosure_level TEXT CHECK (disclosure_level IN ('top', 'top_no_count', 'all', 'none')),
      created_at INTEGER NOT NULL
    )
  `);
  db.run(sql`INSERT INTO rounds_new SELECT * FROM rounds`);
  db.run(sql`DROP TABLE rounds`);
  db.run(sql`ALTER TABLE rounds_new RENAME TO rounds`);
  console.log('Migrated rounds table to support closed status');
} catch (e) {
  // Migration already done or not needed
}

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
