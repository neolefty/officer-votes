import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { sql } from 'drizzle-orm';

const dbPath = process.env.DATABASE_URL || 'election.db';
const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

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
sqlite.close();
