import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import {
  seed,
  unauthedCaller,
  votesForRound,
  voteRecordsForRound,
  expectTRPCError,
} from '../test/harness.js';
import { insertVoteIfRoundOpen } from './round.js';

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

// TESTING_PLAN.md case 18: a vote whose status-guard read passed while the
// round was open must not land its insert after closeVoting has nulled the
// linkage. White-box: the insert step is exercised directly in the ordering
// the race produces, since better-sqlite3's sync driver makes true
// interleaving hard to provoke.
describe('first-cast vote vs close race', () => {
  it('the conditional insert lands while the round is open', async () => {
    const s = await seed();
    const landed = await insertVoteIfRoundOpen({
      id: nanoid(),
      roundId: s.round!.id,
      candidateId: s.teller.id,
      participantId: s.voters[0].id,
    });

    expect(landed).toBe(true);
    const votes = await votesForRound(s.round!.id);
    expect(votes).toHaveLength(1);
    expect(votes[0].participantId).toBe(s.voters[0].id);
  });

  it('a late insert after close is rejected and leaves no linked ballot', async () => {
    const s = await seed();
    // The racing vote already passed its status guard; close completes first.
    await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });

    const landed = await insertVoteIfRoundOpen({
      id: nanoid(),
      roundId: s.round!.id,
      candidateId: s.teller.id,
      participantId: s.voters[0].id,
    });

    expect(landed).toBe(false);
    // Standing invariant: the closed round holds no ballot at all from the
    // late vote, linked or otherwise.
    expect(await votesForRound(s.round!.id)).toHaveLength(0);
    expect(await voteRecordsForRound(s.round!.id)).toHaveLength(0);
  });

  it('a late insert on a cancelled round is rejected', async () => {
    const s = await seed();
    await s.callerFor(s.teller).round.cancel({ roundId: s.round!.id });

    const landed = await insertVoteIfRoundOpen({
      id: nanoid(),
      roundId: s.round!.id,
      candidateId: s.teller.id,
      participantId: s.voters[0].id,
    });

    expect(landed).toBe(false);
    expect(await votesForRound(s.round!.id)).toHaveLength(0);
  });
});
