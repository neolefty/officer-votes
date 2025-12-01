import { db, schema } from './db/index.js';
import { lt } from 'drizzle-orm';

let lastCleanup = 0;
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

export async function maybeCleanupExpired() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  try {
    // Delete all expired elections in a single query
    // Cascade delete handles participants, rounds, votes, voteRecords
    await db
      .delete(schema.elections)
      .where(lt(schema.elections.expiresAt, new Date()));
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}
