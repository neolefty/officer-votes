import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  db,
  schema,
  seed,
  votesForRound,
  voteRecordsForRound,
  expectTRPCError,
} from '../test/harness.js';
import { insertVoteIfRoundOpen } from './round.js';

async function disqualify(s: Awaited<ReturnType<typeof seed>>, targetId: string) {
  return s.callerFor(s.teller).election.disqualifyVoter({ participantId: targetId });
}

describe('election.disqualifyVoter', () => {
  it('retracts the ballot and participation record mid-round', async () => {
    const s = await seed();
    const [victim, other] = s.voters;
    await s.callerFor(victim).round.vote({ roundId: s.round!.id, candidateId: s.teller.id });
    await s.callerFor(other).round.vote({ roundId: s.round!.id, candidateId: other.id });

    await disqualify(s, victim.id);

    const votes = await votesForRound(s.round!.id);
    expect(votes).toHaveLength(1);
    expect(votes[0].participantId).toBe(other.id);
    const records = await voteRecordsForRound(s.round!.id);
    expect(records).toHaveLength(1);
    expect(records[0].participantId).toBe(other.id);
  });

  it('the victim’s choice is absent from the eventual tally', async () => {
    const s = await seed();
    const [victim, other] = s.voters;
    // Victim votes for `other`; other votes for the teller.
    await s.callerFor(victim).round.vote({ roundId: s.round!.id, candidateId: other.id });
    await s.callerFor(other).round.vote({ roundId: s.round!.id, candidateId: s.teller.id });

    await disqualify(s, victim.id);
    const result = await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });

    expect(result.totalVotes).toBe(1);
    expect(result.tallies.find((t) => t.candidateId === other.id)).toBeUndefined();
  });

  it('does not alter a closed round’s tally', async () => {
    const s = await seed();
    const victim = s.voters[0];
    await s.callerFor(victim).round.vote({ roundId: s.round!.id, candidateId: s.teller.id });
    await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });

    await disqualify(s, victim.id);

    // The anonymized, counted ballot stays.
    expect(await votesForRound(s.round!.id)).toHaveLength(1);
  });

  it('blocks the disqualified voter from vote, changeVote, and retractVote', async () => {
    const s = await seed();
    const [victim, other] = s.voters;
    await s.callerFor(victim).round.vote({ roundId: s.round!.id, candidateId: s.teller.id });
    await disqualify(s, victim.id);

    // ctx still holds the pre-DQ row; the guard re-reads from the DB.
    const caller = s.callerFor(victim);
    await expectTRPCError(
      caller.round.vote({ roundId: s.round!.id, candidateId: s.teller.id }),
      'FORBIDDEN'
    );
    await expectTRPCError(
      caller.round.changeVote({ roundId: s.round!.id, candidateId: other.id }),
      'FORBIDDEN'
    );
    await expectTRPCError(caller.round.retractVote({ roundId: s.round!.id }), 'FORBIDDEN');
    expect(await votesForRound(s.round!.id)).toHaveLength(0);
  });

  it('rejects votes for a disqualified candidate in an officer election', async () => {
    const s = await seed();
    const [victim, voter] = s.voters;
    await disqualify(s, victim.id);

    await expectTRPCError(
      s.callerFor(voter).round.vote({ roundId: s.round!.id, candidateId: victim.id }),
      'BAD_REQUEST'
    );
  });

  it('rejects self-disqualification', async () => {
    const s = await seed();
    await expectTRPCError(disqualify(s, s.teller.id), 'BAD_REQUEST');
  });

  it('rejects disqualifying a teller-role participant', async () => {
    const s = await seed();
    const promoted = s.voters[0];
    await s.callerFor(s.teller).election.promoteToTeller({ participantId: promoted.id });

    await expectTRPCError(disqualify(s, promoted.id), 'BAD_REQUEST');
  });

  it('rejects an unknown participant', async () => {
    const s = await seed();
    await expectTRPCError(disqualify(s, 'no-such-id'), 'NOT_FOUND');
  });

  it('is teller-only', async () => {
    const s = await seed();
    await expectTRPCError(
      s.callerFor(s.voters[0]).election.disqualifyVoter({ participantId: s.voters[1].id }),
      'FORBIDDEN'
    );
  });

  it('excludes the disqualified from totalParticipants and voterStatus', async () => {
    const s = await seed({ voters: 3 });
    const victim = s.voters[0];
    await disqualify(s, victim.id);

    const state = await s.callerFor(s.teller).election.get();

    // teller + 2 active voters
    expect(state.totalParticipants).toBe(3);
    expect(state.voterStatus?.some((v) => v.participantId === victim.id)).toBe(false);
    // ...but they remain visible in the participant list, flagged.
    const listed = state.participants.find((p) => p.id === victim.id);
    expect(listed?.disqualifiedAt).not.toBeNull();
  });

  it('still resolves the name of a disqualified participant in a revealed tally', async () => {
    const s = await seed();
    const [victim, voter] = s.voters;
    await s.callerFor(voter).round.vote({ roundId: s.round!.id, candidateId: victim.id });
    await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });
    await s.callerFor(s.teller).round.end({ roundId: s.round!.id, disclosureLevel: 'all' });

    await disqualify(s, victim.id);

    const state = await s.callerFor(s.teller).election.get();
    const tally = state.roundLog[0]?.result?.tallies.find((t) => t.candidateId === victim.id);
    expect(tally?.candidateName).toBe(victim.name);
  });

  describe('DQ vs vote race', () => {
    it('an insert landing after the disqualification flag is a no-op', async () => {
      const s = await seed();
      const victim = s.voters[0];
      // Simulate the race ordering: the racing vote passed its guards, then
      // disqualifyVoter set the flag (and swept — nothing to sweep yet), and
      // only then does the insert land.
      await disqualify(s, victim.id);

      const landed = await insertVoteIfRoundOpen({
        id: nanoid(),
        roundId: s.round!.id,
        candidateId: s.teller.id,
        participantId: victim.id,
      });

      expect(landed).toBe(false);
      expect(await votesForRound(s.round!.id)).toHaveLength(0);
    });

    it('an insert landing before the flag is swept by the disqualification', async () => {
      const s = await seed();
      const victim = s.voters[0];
      await s.callerFor(victim).round.vote({ roundId: s.round!.id, candidateId: s.teller.id });

      await disqualify(s, victim.id);
      await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });

      // No orphan ballot, and the standing anonymity invariant holds.
      expect(await votesForRound(s.round!.id)).toHaveLength(0);
      const linked = await db.query.votes.findMany({
        where: eq(schema.votes.roundId, s.round!.id),
      });
      expect(linked.every((v) => v.participantId === null)).toBe(true);
    });
  });
});

describe('election.reinstateVoter', () => {
  it('clears the flag and the voter can vote fresh mid-round', async () => {
    const s = await seed();
    const victim = s.voters[0];
    await s.callerFor(victim).round.vote({ roundId: s.round!.id, candidateId: s.teller.id });
    await disqualify(s, victim.id);

    await s.callerFor(s.teller).election.reinstateVoter({ participantId: victim.id });

    // Their voteRecord was deleted on DQ, so the "already voted" guard clears.
    await s.callerFor(victim).round.vote({ roundId: s.round!.id, candidateId: victim.id });
    const votes = await votesForRound(s.round!.id);
    expect(votes).toHaveLength(1);
    expect(votes[0].candidateId).toBe(victim.id);
  });

  it('rejects an unknown participant', async () => {
    const s = await seed();
    await expectTRPCError(
      s.callerFor(s.teller).election.reinstateVoter({ participantId: 'no-such-id' }),
      'NOT_FOUND'
    );
  });

  it('is teller-only', async () => {
    const s = await seed();
    await expectTRPCError(
      s.callerFor(s.voters[0]).election.reinstateVoter({ participantId: s.voters[1].id }),
      'FORBIDDEN'
    );
  });
});

describe('election.promoteToTeller with disqualification', () => {
  it('rejects promoting a disqualified participant', async () => {
    const s = await seed();
    const victim = s.voters[0];
    await disqualify(s, victim.id);

    await expectTRPCError(
      s.callerFor(s.teller).election.promoteToTeller({ participantId: victim.id }),
      'BAD_REQUEST'
    );
  });
});
