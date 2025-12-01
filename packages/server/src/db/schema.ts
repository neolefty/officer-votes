import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const elections = sqliteTable('elections', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  bodySize: integer('body_size'), // If set, majority is calculated against this, not voter count
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
  status: text('status', { enum: ['voting', 'closed', 'revealed', 'cancelled'] }).notNull(),
  disclosureLevel: text('disclosure_level', { enum: ['top', 'top_no_count', 'all', 'none'] }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

// Votes: no link to voter, just roundId + candidateId
export const votes = sqliteTable('votes', {
  id: text('id').primaryKey(),
  roundId: text('round_id').notNull().references(() => rounds.id, { onDelete: 'cascade' }),
  candidateId: text('candidate_id'), // null = abstain
});

// Track who has voted (separate from vote content)
export const voteRecords = sqliteTable('vote_records', {
  id: text('id').primaryKey(),
  roundId: text('round_id').notNull().references(() => rounds.id, { onDelete: 'cascade' }),
  participantId: text('participant_id').notNull().references(() => participants.id, { onDelete: 'cascade' }),
  votedAt: integer('voted_at', { mode: 'timestamp' }).notNull(),
});
