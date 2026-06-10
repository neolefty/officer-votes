import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  db,
  schema,
  seed,
  unauthedCaller,
  votesForRound,
  voteRecordsForRound,
  expectTRPCError,
} from '../test/harness.js';

describe('round.changeVote', () => {
  it('re-points the ballot without changing the voted count', async () => {
    const s = await seed();
    const [voter, candidateA, candidateB] = s.voters;
    const caller = s.callerFor(voter);
    await caller.round.vote({ roundId: s.round!.id, candidateId: candidateA.id });

    await caller.round.changeVote({ roundId: s.round!.id, candidateId: candidateB.id });

    const votes = await votesForRound(s.round!.id);
    expect(votes).toHaveLength(1);
    expect(votes[0].candidateId).toBe(candidateB.id);
    expect(await voteRecordsForRound(s.round!.id)).toHaveLength(1);
  });

  it('bumps voteRecords.votedAt', async () => {
    const s = await seed();
    const voter = s.voters[0];
    const caller = s.callerFor(voter);
    await caller.round.vote({ roundId: s.round!.id, candidateId: s.voters[1].id });

    const old = new Date(Date.now() - 60_000);
    await db
      .update(schema.voteRecords)
      .set({ votedAt: old })
      .where(
        and(
          eq(schema.voteRecords.roundId, s.round!.id),
          eq(schema.voteRecords.participantId, voter.id)
        )
      );

    await caller.round.changeVote({ roundId: s.round!.id, candidateId: s.voters[2].id });

    const [record] = await voteRecordsForRound(s.round!.id);
    expect(record.votedAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it('changes a candidate vote to an abstention', async () => {
    const s = await seed();
    const caller = s.callerFor(s.voters[0]);
    await caller.round.vote({ roundId: s.round!.id, candidateId: s.voters[1].id });

    await caller.round.changeVote({ roundId: s.round!.id, candidateId: null });

    const votes = await votesForRound(s.round!.id);
    expect(votes).toHaveLength(1);
    expect(votes[0].candidateId).toBeNull();
    // Still counts as having voted
    expect(await voteRecordsForRound(s.round!.id)).toHaveLength(1);
  });

  it('changes an abstention to a candidate vote', async () => {
    const s = await seed();
    const caller = s.callerFor(s.voters[0]);
    await caller.round.vote({ roundId: s.round!.id, candidateId: null });

    await caller.round.changeVote({ roundId: s.round!.id, candidateId: s.voters[1].id });

    const votes = await votesForRound(s.round!.id);
    expect(votes).toHaveLength(1);
    expect(votes[0].candidateId).toBe(s.voters[1].id);
  });

  it('rejects a change with no prior ballot', async () => {
    const s = await seed();
    await expectTRPCError(
      s.callerFor(s.voters[0]).round.changeVote({ roundId: s.round!.id, candidateId: null }),
      'BAD_REQUEST'
    );
  });

  it('rejects a change on a closed round', async () => {
    const s = await seed();
    const caller = s.callerFor(s.voters[0]);
    await caller.round.vote({ roundId: s.round!.id, candidateId: s.voters[1].id });
    await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });

    await expectTRPCError(
      caller.round.changeVote({ roundId: s.round!.id, candidateId: s.voters[2].id }),
      'NOT_FOUND'
    );
  });

  it('rejects a change to a non-existent candidate', async () => {
    const s = await seed();
    const caller = s.callerFor(s.voters[0]);
    await caller.round.vote({ roundId: s.round!.id, candidateId: s.voters[1].id });

    await expectTRPCError(
      caller.round.changeVote({ roundId: s.round!.id, candidateId: 'no-such-id' }),
      'BAD_REQUEST'
    );
  });

  it('rejects unauthenticated change', async () => {
    const s = await seed();
    await expectTRPCError(
      unauthedCaller().round.changeVote({ roundId: s.round!.id, candidateId: null }),
      'UNAUTHORIZED'
    );
  });

  describe('by-election eligibility', () => {
    it('rejects a change to a removed or round-ineligible candidate', async () => {
      const s = await seed({
        electionType: 'by_election',
        candidates: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol', removed: true }],
        eligibleCandidateNames: ['Alice'],
      });
      const [alice, bob, carol] = s.candidates;
      const caller = s.callerFor(s.voters[0]);
      await caller.round.vote({ roundId: s.round!.id, candidateId: alice.id });

      // Soft-deleted from the roster
      await expectTRPCError(
        caller.round.changeVote({ roundId: s.round!.id, candidateId: carol.id }),
        'BAD_REQUEST'
      );
      // Active in the roster but outside this round's eligible subset
      await expectTRPCError(
        caller.round.changeVote({ roundId: s.round!.id, candidateId: bob.id }),
        'BAD_REQUEST'
      );

      const votes = await votesForRound(s.round!.id);
      expect(votes[0].candidateId).toBe(alice.id);
    });
  });
});

describe('round.retractVote', () => {
  it('removes the ballot and the participation record', async () => {
    const s = await seed();
    const caller = s.callerFor(s.voters[0]);
    await caller.round.vote({ roundId: s.round!.id, candidateId: s.voters[1].id });

    await caller.round.retractVote({ roundId: s.round!.id });

    expect(await votesForRound(s.round!.id)).toHaveLength(0);
    expect(await voteRecordsForRound(s.round!.id)).toHaveLength(0);
  });

  it('returns the voter to not-voted so they can vote again', async () => {
    const s = await seed();
    const caller = s.callerFor(s.voters[0]);
    await caller.round.vote({ roundId: s.round!.id, candidateId: s.voters[1].id });
    await caller.round.retractVote({ roundId: s.round!.id });

    await caller.round.vote({ roundId: s.round!.id, candidateId: s.voters[2].id });

    const votes = await votesForRound(s.round!.id);
    expect(votes).toHaveLength(1);
    expect(votes[0].candidateId).toBe(s.voters[2].id);
  });

  it('only removes the retracting voter’s ballot', async () => {
    const s = await seed();
    const [v1, v2] = s.voters;
    await s.callerFor(v1).round.vote({ roundId: s.round!.id, candidateId: s.teller.id });
    await s.callerFor(v2).round.vote({ roundId: s.round!.id, candidateId: s.teller.id });

    await s.callerFor(v1).round.retractVote({ roundId: s.round!.id });

    expect(await votesForRound(s.round!.id)).toHaveLength(1);
    const records = await voteRecordsForRound(s.round!.id);
    expect(records).toHaveLength(1);
    expect(records[0].participantId).toBe(v2.id);
  });

  it('rejects a retraction with no prior ballot', async () => {
    const s = await seed();
    await expectTRPCError(
      s.callerFor(s.voters[0]).round.retractVote({ roundId: s.round!.id }),
      'BAD_REQUEST'
    );
  });

  it('rejects a retraction on a closed round', async () => {
    const s = await seed();
    const caller = s.callerFor(s.voters[0]);
    await caller.round.vote({ roundId: s.round!.id, candidateId: s.voters[1].id });
    await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });

    await expectTRPCError(caller.round.retractVote({ roundId: s.round!.id }), 'NOT_FOUND');
  });

  it('rejects unauthenticated retraction', async () => {
    const s = await seed();
    await expectTRPCError(
      unauthedCaller().round.retractVote({ roundId: s.round!.id }),
      'UNAUTHORIZED'
    );
  });
});
