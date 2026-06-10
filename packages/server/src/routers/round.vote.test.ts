import { describe, it, expect } from 'vitest';
import {
  seed,
  unauthedCaller,
  votesForRound,
  voteRecordsForRound,
  expectTRPCError,
} from '../test/harness.js';

describe('round.vote', () => {
  it('records a ballot and a participation record', async () => {
    const s = await seed();
    const [voter, candidate] = s.voters;

    await s.callerFor(voter).round.vote({ roundId: s.round!.id, candidateId: candidate.id });

    const votes = await votesForRound(s.round!.id);
    expect(votes).toHaveLength(1);
    expect(votes[0].candidateId).toBe(candidate.id);

    const records = await voteRecordsForRound(s.round!.id);
    expect(records).toHaveLength(1);
    expect(records[0].participantId).toBe(voter.id);
  });

  it('records an abstention as a null candidateId', async () => {
    const s = await seed();
    await s.callerFor(s.voters[0]).round.vote({ roundId: s.round!.id, candidateId: null });

    const votes = await votesForRound(s.round!.id);
    expect(votes).toHaveLength(1);
    expect(votes[0].candidateId).toBeNull();
  });

  it('rejects a second vote from the same participant', async () => {
    const s = await seed();
    const caller = s.callerFor(s.voters[0]);
    await caller.round.vote({ roundId: s.round!.id, candidateId: s.voters[1].id });

    await expectTRPCError(
      caller.round.vote({ roundId: s.round!.id, candidateId: s.voters[2].id }),
      'BAD_REQUEST'
    );
    expect(await votesForRound(s.round!.id)).toHaveLength(1);
  });

  it('rejects a vote for a non-existent candidate', async () => {
    const s = await seed();
    await expectTRPCError(
      s.callerFor(s.voters[0]).round.vote({ roundId: s.round!.id, candidateId: 'no-such-id' }),
      'BAD_REQUEST'
    );
  });

  it('rejects voting on a closed round', async () => {
    const s = await seed();
    await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });

    await expectTRPCError(
      s.callerFor(s.voters[0]).round.vote({ roundId: s.round!.id, candidateId: s.voters[1].id }),
      'NOT_FOUND'
    );
  });

  it('rejects an unauthenticated vote', async () => {
    const s = await seed();
    await expectTRPCError(
      unauthedCaller().round.vote({ roundId: s.round!.id, candidateId: null }),
      'UNAUTHORIZED'
    );
  });
});
