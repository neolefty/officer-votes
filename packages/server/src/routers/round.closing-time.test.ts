import { describe, it, expect } from 'vitest';
import {
  seed,
  votesForRound,
  expectTRPCError,
} from '../test/harness.js';

const past = () => Date.now() - 1_000;
const future = () => Date.now() + 60_000;

describe('round.setClosesAt', () => {
  it('sets, extends, and clears the closing time', async () => {
    const s = await seed();
    const teller = s.callerFor(s.teller);

    const closesAt = future();
    await teller.round.setClosesAt({ roundId: s.round!.id, closesAt });
    let state = await teller.election.get();
    expect(state.currentRound?.closesAt).toBe(closesAt);

    const extended = closesAt + 60_000;
    await teller.round.setClosesAt({ roundId: s.round!.id, closesAt: extended });
    state = await teller.election.get();
    expect(state.currentRound?.closesAt).toBe(extended);

    await teller.round.setClosesAt({ roundId: s.round!.id, closesAt: null });
    state = await teller.election.get();
    expect(state.currentRound?.closesAt).toBeNull();
  });

  it('reports the server clock for client countdowns', async () => {
    const s = await seed();
    const before = Date.now();
    const state = await s.callerFor(s.teller).election.get();
    expect(state.serverNow).toBeGreaterThanOrEqual(before);
    expect(state.serverNow).toBeLessThanOrEqual(Date.now());
  });

  it('is teller-only', async () => {
    const s = await seed();
    await expectTRPCError(
      s.callerFor(s.voters[0]).round.setClosesAt({ roundId: s.round!.id, closesAt: future() }),
      'FORBIDDEN'
    );
  });

  it('rejects a round that is not voting', async () => {
    const s = await seed();
    const teller = s.callerFor(s.teller);
    await teller.round.closeVoting({ roundId: s.round!.id });

    await expectTRPCError(
      teller.round.setClosesAt({ roundId: s.round!.id, closesAt: future() }),
      'NOT_FOUND'
    );
  });
});

describe('ending-soon lock', () => {
  async function seedLocked() {
    const s = await seed();
    const voter = s.callerFor(s.voters[0]);
    await voter.round.vote({ roundId: s.round!.id, candidateId: s.teller.id });
    await s.callerFor(s.teller).round.setClosesAt({ roundId: s.round!.id, closesAt: past() });
    return s;
  }

  it('rejects changeVote and retractVote once the closing time passes', async () => {
    const s = await seedLocked();
    const voter = s.callerFor(s.voters[0]);

    await expectTRPCError(
      voter.round.changeVote({ roundId: s.round!.id, candidateId: null }),
      'BAD_REQUEST'
    );
    await expectTRPCError(voter.round.retractVote({ roundId: s.round!.id }), 'BAD_REQUEST');
    // The ballot is untouched.
    const votes = await votesForRound(s.round!.id);
    expect(votes).toHaveLength(1);
    expect(votes[0].candidateId).toBe(s.teller.id);
  });

  it('still accepts a first-time vote (soft lock: voting stays open)', async () => {
    const s = await seedLocked();

    await s.callerFor(s.voters[1]).round.vote({ roundId: s.round!.id, candidateId: s.teller.id });

    expect(await votesForRound(s.round!.id)).toHaveLength(2);
  });

  it('extending the closing time re-opens changes', async () => {
    const s = await seedLocked();
    await s.callerFor(s.teller).round.setClosesAt({ roundId: s.round!.id, closesAt: future() });

    await s.callerFor(s.voters[0]).round.changeVote({ roundId: s.round!.id, candidateId: null });

    const votes = await votesForRound(s.round!.id);
    expect(votes[0].candidateId).toBeNull();
  });

  it('clearing the closing time re-opens changes', async () => {
    const s = await seedLocked();
    await s.callerFor(s.teller).round.setClosesAt({ roundId: s.round!.id, closesAt: null });

    await s.callerFor(s.voters[0]).round.retractVote({ roundId: s.round!.id });

    expect(await votesForRound(s.round!.id)).toHaveLength(0);
  });

  it('closeVoting still works while locked and severs the linkage', async () => {
    const s = await seedLocked();

    const result = await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });

    expect(result.totalVotes).toBe(1);
    const votes = await votesForRound(s.round!.id);
    expect(votes.every((v) => v.participantId === null)).toBe(true);
  });
});
