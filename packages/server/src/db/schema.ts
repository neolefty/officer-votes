import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const elections = sqliteTable('elections', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  bodySize: integer('body_size'), // If set, majority is calculated against this, not voter count
  electionType: text('election_type', { enum: ['officer', 'by_election'] }).notNull().default('officer'),
  vacancyCount: integer('vacancy_count'), // null for officer elections; default 1 on by-elections
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
});

export const participants = sqliteTable('participants', {
  id: text('id').primaryKey(),
  electionId: text('election_id').notNull().references(() => elections.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  role: text('role', { enum: ['teller', 'voter'] }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const rounds = sqliteTable('rounds', {
  id: text('id').primaryKey(),
  electionId: text('election_id').notNull().references(() => elections.id, { onDelete: 'cascade' }),
  office: text('office').notNull(),
  description: text('description'),
  // Denormalized from parent election to avoid a JOIN on the vote hot path.
  electionType: text('election_type', { enum: ['officer', 'by_election'] }).notNull().default('officer'),
  // JSON-encoded string[] of candidate IDs eligible for this round (e.g. runoff). null = full active roster.
  eligibleCandidateIds: text('eligible_candidate_ids'),
  status: text('status', { enum: ['voting', 'closed', 'revealed', 'cancelled'] }).notNull(),
  disclosureLevel: text('disclosure_level', { enum: ['top', 'top_no_count', 'all', 'none'] }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Votes: no link to voter, just roundId + candidateId.
// candidateId is interpreted against the parent round.electionType:
//   officer => participants.id, by_election => candidates.id. No FK by design.
export const votes = sqliteTable('votes', {
  id: text('id').primaryKey(),
  roundId: text('round_id').notNull().references(() => rounds.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id'), // null = abstain
  // Ephemeral voter linkage: written while the round is `voting` so the voter
  // can change/withdraw their own ballot, NULLed at closeVoting. Never appears
  // in any tRPC response or SSE payload. See LONG_RUNNING_ELECTIONS_PLAN.md.
  participantId: text('participant_id'),
});

// Track who has voted (separate from vote content)
export const voteRecords = sqliteTable('vote_records', {
  id: text('id').primaryKey(),
  roundId: text('round_id').notNull().references(() => rounds.id, { onDelete: 'cascade' }),
  participantId: text('participant_id').notNull().references(() => participants.id, { onDelete: 'cascade' }),
  votedAt: integer('voted_at', { mode: 'timestamp' }).notNull(),
});

// By-election candidate roster. Distinct from `participants` because the
// candidate pool for a by-election is the broader community, not the assembly.
export const candidates = sqliteTable('candidates', {
  id: text('id').primaryKey(),
  electionId: text('election_id').notNull().references(() => elections.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  displayOrder: integer('display_order').notNull(),
  removedAt: integer('removed_at'), // unix ms; null = active (soft-delete)
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
