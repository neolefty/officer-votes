import { describe, it, expect } from 'vitest';
import { seed, expectTRPCError } from '../test/harness.js';
import type { Seeded } from '../test/harness.js';

function countFor(result: { tallies: { candidateId: string | null; count: number }[] }, candidateId: string | null) {
  return result.tallies.find((t) => t.candidateId === candidateId)?.count ?? 0;
}

describe('round.closeVoting', () => {
  async function castVotes(s: Seeded, choices: (string | null)[]) {
    for (const [i, candidateId] of choices.entries()) {
      await s.callerFor(s.voters[i]).round.vote({ roundId: s.round!.id, candidateId });
    }
  }

  it('tallies reflect a changed vote', async () => {
    const s = await seed({ voters: 3 });
    const a = s.teller.id;
    const b = s.voters[0].id;
    await castVotes(s, [a, a, b]);

    // Voter 2 changes A → B; the final tally must count B, not A.
    await s.callerFor(s.voters[1]).round.changeVote({ roundId: s.round!.id, candidateId: b });
    const result = await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });

    expect(result.totalVotes).toBe(3);
    expect(countFor(result, b)).toBe(2);
    expect(countFor(result, a)).toBe(1);
  });

  it('tallies drop a withdrawn vote', async () => {
    const s = await seed({ voters: 3 });
    const a = s.teller.id;
    await castVotes(s, [a, a, a]);

    await s.callerFor(s.voters[2]).round.retractVote({ roundId: s.round!.id });
    const result = await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });

    expect(result.totalVotes).toBe(2);
    expect(countFor(result, a)).toBe(2);
  });

  it('computes officer majority against bodySize', async () => {
    const s = await seed({ voters: 3, bodySize: 9 });
    const a = s.teller.id;
    await castVotes(s, [a, a, a]);

    const result = await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });
    if (result.electionType !== 'officer') throw new Error('expected officer result');

    // 3 of a 9-member body is not a majority (threshold 5)
    expect(result.majorityThreshold).toBe(5);
    expect(result.hasMajority).toBe(false);
  });

  it('rejects closing a round that is not voting', async () => {
    const s = await seed();
    const teller = s.callerFor(s.teller);
    await teller.round.closeVoting({ roundId: s.round!.id });

    await expectTRPCError(teller.round.closeVoting({ roundId: s.round!.id }), 'NOT_FOUND');
  });

  it('is teller-only', async () => {
    const s = await seed();
    await expectTRPCError(
      s.callerFor(s.voters[0]).round.closeVoting({ roundId: s.round!.id }),
      'FORBIDDEN'
    );
  });

  it('change and retract lose the race to close', async () => {
    const s = await seed();
    const caller = s.callerFor(s.voters[0]);
    await caller.round.vote({ roundId: s.round!.id, candidateId: s.teller.id });
    await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });

    // Status flips first, so mutations requiring `voting` are rejected.
    await expectTRPCError(
      caller.round.changeVote({ roundId: s.round!.id, candidateId: null }),
      'NOT_FOUND'
    );
    await expectTRPCError(caller.round.retractVote({ roundId: s.round!.id }), 'NOT_FOUND');
  });
});
