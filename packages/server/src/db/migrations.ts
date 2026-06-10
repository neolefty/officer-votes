import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

// Minimal interface for migration - both libsql and better-sqlite3 support this
export interface MigrationDb {
  run(query: SQL): unknown;
}

// Hand-rolled boot migrations: CREATE TABLE IF NOT EXISTS plus try/catch
// additive ALTERs. Runs against dev (better-sqlite3), prod (libsql/Turso),
// and the test harness's in-memory DB. See LONG_RUNNING_ELECTIONS_PLAN.md
// for the planned drizzle-kit replacement.
export async function runMigrations(
  db: MigrationDb,
  { log = console.log }: { log?: (message: string) => void } = {}
): Promise<void> {
  await db.run(sql`
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
    await db.run(sql`ALTER TABLE elections ADD COLUMN body_size INTEGER`);
  } catch {
    // Column already exists, ignore
  }

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      election_id TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('teller', 'voter')),
      token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )
  `);

  await db.run(sql`
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
    await db.run(sql`
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
    await db.run(sql`INSERT INTO rounds_new SELECT * FROM rounds`);
    await db.run(sql`DROP TABLE rounds`);
    await db.run(sql`ALTER TABLE rounds_new RENAME TO rounds`);
    log('Migrated rounds table to support closed status');
  } catch {
    // Migration already done or not needed
  }

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      candidate_id TEXT,
      participant_id TEXT
    )
  `);

  // Ephemeral voter linkage (change/withdraw support). Nullable + transient:
  // set while voting, nulled at closeVoting. Additive for existing dev DBs.
  try {
    await db.run(sql`ALTER TABLE votes ADD COLUMN participant_id TEXT`);
  } catch {
    // Column already exists, ignore
  }

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS vote_records (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      voted_at INTEGER NOT NULL
    )
  `);

  // By-election support: add election_type + vacancy_count to elections
  try {
    await db.run(sql`ALTER TABLE elections ADD COLUMN election_type TEXT NOT NULL DEFAULT 'officer'`);
  } catch {
    // Column already exists, ignore
  }
  try {
    await db.run(sql`ALTER TABLE elections ADD COLUMN vacancy_count INTEGER`);
  } catch {
    // Column already exists, ignore
  }

  // By-election support: add election_type + eligible_candidate_ids to rounds
  try {
    await db.run(sql`ALTER TABLE rounds ADD COLUMN election_type TEXT NOT NULL DEFAULT 'officer'`);
  } catch {
    // Column already exists, ignore
  }
  try {
    await db.run(sql`ALTER TABLE rounds ADD COLUMN eligible_candidate_ids TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // By-election candidate roster (separate from participants)
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      election_id TEXT NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      display_order INTEGER NOT NULL,
      removed_at INTEGER,
      created_at INTEGER NOT NULL
    )
  `);

  await db.run(sql`CREATE INDEX IF NOT EXISTS candidates_election_idx ON candidates (election_id)`);

  log('Database tables created successfully');
}
