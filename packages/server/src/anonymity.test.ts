import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  seed,
  votesForRound,
  findKeyPaths,
} from './test/harness.js';
import type { Seeded } from './test/harness.js';
import { sseManager } from './sse.js';
import { getElectionState } from './utils.js';

// The standing anonymity invariant (LONG_RUNNING_ELECTIONS_PLAN.md §keystone):
// for any round whose status != 'voting', no votes row may carry a
// participant_id — and no response or SSE payload may ever tie a ballot to a
// voter.

afterEach(() => {
  vi.restoreAllMocks();
});

async function castAll(s: Seeded, candidateId: string | null) {
  for (const voter of s.voters) {
    await s.callerFor(voter).round.vote({ roundId: s.round!.id, candidateId });
  }
}

describe('at-rest anonymity', () => {
  it('positive control: open-round ballots do carry the voter linkage', async () => {
    const s = await seed();
    await s.callerFor(s.voters[0]).round.vote({ roundId: s.round!.id, candidateId: s.teller.id });

    const votes = await votesForRound(s.round!.id);
    expect(votes).toHaveLength(1);
    expect(votes[0].participantId).toBe(s.voters[0].id);
  });

  it('closeVoting severs the linkage but keeps the ballots', async () => {
    const s = await seed({ voters: 3 });
    await castAll(s, s.teller.id);

    const result = await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });

    const votes = await votesForRound(s.round!.id);
    expect(votes).toHaveLength(3);
    for (const vote of votes) {
      expect(vote.participantId).toBeNull();
    }
    // Severing the link must not alter the tally
    expect(result.totalVotes).toBe(3);
    expect(result.tallies.find((t) => t.candidateId === s.teller.id)?.count).toBe(3);
  });

  it('cancel deletes the round’s ballots outright', async () => {
    const s = await seed({ voters: 2 });
    await castAll(s, s.teller.id);

    await s.callerFor(s.teller).round.cancel({ roundId: s.round!.id });

    expect(await votesForRound(s.round!.id)).toHaveLength(0);
  });
});

describe('in-transit anonymity', () => {
  it('vote_status broadcasts carry participantId only under voterStatus', async () => {
    const s = await seed();
    const broadcast = vi.spyOn(sseManager, 'broadcast');

    await s.callerFor(s.voters[0]).round.vote({ roundId: s.round!.id, candidateId: s.teller.id });

    const voteStatusCalls = broadcast.mock.calls.filter(([, event]) => event === 'vote_status');
    expect(voteStatusCalls.length).toBeGreaterThan(0);
    for (const [, , payload] of voteStatusCalls) {
      const leaks = findKeyPaths(payload, 'participantId').filter(
        (p) => !p.includes('.voterStatus[')
      );
      expect(leaks).toEqual([]);
    }
  });

  it('the closeVoting result contains no participantId', async () => {
    const s = await seed();
    await castAll(s, s.teller.id);

    const result = await s.callerFor(s.teller).round.closeVoting({ roundId: s.round!.id });

    expect(findKeyPaths(result, 'participantId')).toEqual([]);
  });

  it('getElectionState carries participantId only under voterStatus', async () => {
    const s = await seed();
    await castAll(s, s.teller.id);

    // Teller view includes voterStatus (participation, not vote content)
    const state = await getElectionState(s.election, s.teller);

    const leaks = findKeyPaths(state, 'participantId').filter(
      (p) => !p.includes('.voterStatus[')
    );
    expect(leaks).toEqual([]);
  });

  it('the round_ended broadcast (revealed results) contains no participantId', async () => {
    const s = await seed();
    await castAll(s, s.teller.id);
    const teller = s.callerFor(s.teller);
    await teller.round.closeVoting({ roundId: s.round!.id });

    const broadcast = vi.spyOn(sseManager, 'broadcast');
    await teller.round.end({ roundId: s.round!.id, disclosureLevel: 'all' });

    const endedCalls = broadcast.mock.calls.filter(([, event]) => event === 'round_ended');
    expect(endedCalls.length).toBe(1);
    expect(findKeyPaths(endedCalls[0][2], 'participantId')).toEqual([]);
  });
});
