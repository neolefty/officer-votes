import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { expect } from 'vitest';
import { TRPCError } from '@trpc/server';
import { db, schema } from '../db/index.js';
import { runMigrations } from '../db/migrations.js';
import { appRouter } from '../routers/index.js';

// Each test file gets a fresh in-memory DB: vitest.setup.ts points
// DATABASE_URL at ':memory:' and vitest isolates module state per file, so
// the db singleton is a new empty database here.
await runMigrations(db, { log: () => {} });

export { db, schema, appRouter };

export type TestParticipant = typeof schema.participants.$inferSelect;
export type TestElection = typeof schema.elections.$inferSelect;
export type TestRound = typeof schema.rounds.$inferSelect;
export type TestCandidate = typeof schema.candidates.$inferSelect;

export interface SeedOptions {
  voters?: number;
  electionType?: 'officer' | 'by_election';
  bodySize?: number;
  vacancyCount?: number;
  /** By-election roster; `removed: true` soft-deletes the candidate. */
  candidates?: { name: string; removed?: boolean }[];
  /** Start a round in `voting` status (default true). */
  startRound?: boolean;
  /** Restrict the round to these roster names (by-election runoffs). */
  eligibleCandidateNames?: string[];
}

export interface Seeded {
  election: TestElection;
  teller: TestParticipant;
  voters: TestParticipant[];
  candidates: TestCandidate[];
  round: TestRound | null;
  callerFor: (participant: TestParticipant) => ReturnType<typeof appRouter.createCaller>;
}

export async function seed(opts: SeedOptions = {}): Promise<Seeded> {
  const {
    voters: voterCount = 3,
    electionType = 'officer',
    bodySize,
    vacancyCount,
    candidates: candidateSpecs = [],
    startRound = true,
    eligibleCandidateNames,
  } = opts;

  const now = new Date();
  const electionId = nanoid();
  await db.insert(schema.elections).values({
    id: electionId,
    code: nanoid(6).toUpperCase(),
    name: 'Test Election',
    bodySize: bodySize ?? null,
    electionType,
    vacancyCount: electionType === 'by_election' ? (vacancyCount ?? 1) : null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  });
  const election = (await db.query.elections.findFirst({
    where: eq(schema.elections.id, electionId),
  }))!;

  async function insertParticipant(name: string, role: 'teller' | 'voter') {
    const id = nanoid();
    await db.insert(schema.participants).values({
      id,
      electionId,
      name,
      role,
      token: nanoid(),
      createdAt: now,
    });
    return (await db.query.participants.findFirst({
      where: eq(schema.participants.id, id),
    }))!;
  }

  const teller = await insertParticipant('Teller', 'teller');
  const voters: TestParticipant[] = [];
  for (let i = 1; i <= voterCount; i++) {
    voters.push(await insertParticipant(`Voter ${i}`, 'voter'));
  }

  const candidates: TestCandidate[] = [];
  for (const [i, spec] of candidateSpecs.entries()) {
    const id = nanoid();
    await db.insert(schema.candidates).values({
      id,
      electionId,
      name: spec.name,
      displayOrder: i,
      removedAt: spec.removed ? now.getTime() : null,
      createdAt: now,
    });
    candidates.push((await db.query.candidates.findFirst({
      where: eq(schema.candidates.id, id),
    }))!);
  }

  let round: TestRound | null = null;
  if (startRound) {
    const roundId = nanoid();
    const eligibleIds = eligibleCandidateNames
      ? candidates
          .filter((c) => eligibleCandidateNames.includes(c.name))
          .map((c) => c.id)
      : null;
    await db.insert(schema.rounds).values({
      id: roundId,
      electionId,
      office: 'Chair',
      electionType,
      eligibleCandidateIds: eligibleIds ? JSON.stringify(eligibleIds) : null,
      status: 'voting',
      createdAt: now,
    });
    round = (await db.query.rounds.findFirst({
      where: eq(schema.rounds.id, roundId),
    }))!;
  }

  return {
    election,
    teller,
    voters,
    candidates,
    round,
    callerFor: (participant) =>
      appRouter.createCaller({ req: {} as Request, participant, election }),
  };
}

export function unauthedCaller() {
  return appRouter.createCaller({ req: {} as Request, participant: null, election: null });
}

export async function votesForRound(roundId: string) {
  return db.query.votes.findMany({ where: eq(schema.votes.roundId, roundId) });
}

export async function voteRecordsForRound(roundId: string) {
  return db.query.voteRecords.findMany({ where: eq(schema.voteRecords.roundId, roundId) });
}

export async function expectTRPCError(promise: Promise<unknown>, code: TRPCError['code']) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe(code);
    return;
  }
  throw new Error(`Expected TRPCError ${code}, but the call succeeded`);
}

/**
 * Recursively collect the paths at which `key` appears anywhere in `value`.
 * Used by the in-transit anonymity tests to prove `participantId` never
 * appears on vote-shaped objects in responses or SSE payloads.
 */
export function findKeyPaths(value: unknown, key: string, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => findKeyPaths(v, key, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(k === key ? [`${path}.${k}`] : []),
      ...findKeyPaths(v, key, `${path}.${k}`),
    ]);
  }
  return [];
}
