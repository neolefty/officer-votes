import { eq, desc } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import type { ElectionState, RoundLogEntry, RoundResult, VoteTally } from '@officer-election/shared';

/**
 * Count votes by candidate, returning a Map of candidateId -> count
 */
export function countVotes(votes: { candidateId: string | null }[]): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const vote of votes) {
    counts.set(vote.candidateId, (counts.get(vote.candidateId) || 0) + 1);
  }
  return counts;
}

/**
 * Build sorted vote tallies from vote counts
 */
export function buildTallies(
  voteCounts: Map<string | null, number>,
  participants: { id: string; name: string }[]
): VoteTally[] {
  return Array.from(voteCounts.entries())
    .map(([candidateId, count]) => ({
      candidateId,
      candidateName: candidateId
        ? participants.find((p) => p.id === candidateId)?.name || 'Unknown'
        : null,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Check if the top vote count constitutes a majority.
 * Majority = more than half of the base (> 50%).
 */
export function hasMajority(topCount: number, majorityBase: number): boolean {
  return topCount > majorityBase / 2;
}

/**
 * Get the majority threshold (minimum votes needed for majority).
 */
export function getMajorityThreshold(majorityBase: number): number {
  return Math.floor(majorityBase / 2) + 1;
}

/**
 * Filter tallies to only include top candidates (those with the highest count).
 */
export function getTopCandidates(tallies: VoteTally[]): VoteTally[] {
  if (tallies.length === 0) return [];
  const topCount = tallies[0].count;
  return tallies.filter((t) => t.count === topCount);
}

export async function getElectionState(
  election: typeof schema.elections.$inferSelect,
  participant: typeof schema.participants.$inferSelect
): Promise<ElectionState> {
  const participants = await db.query.participants.findMany({
    where: eq(schema.participants.electionId, election.id),
    orderBy: schema.participants.createdAt,
  });

  const rounds = await db.query.rounds.findMany({
    where: eq(schema.rounds.electionId, election.id),
    orderBy: desc(schema.rounds.createdAt),
  });

  // Most recent round is first (sorted by createdAt desc)
  const mostRecentRound = rounds[0] || null;

  // Active round = most recent round if it's still in progress (voting or closed)
  // Old rounds stuck in 'closed' status are ignored
  const isActiveStatus = mostRecentRound && (mostRecentRound.status === 'voting' || mostRecentRound.status === 'closed');
  const currentRound = isActiveStatus && mostRecentRound.status === 'voting' ? mostRecentRound : null;
  const pendingRound = isActiveStatus && mostRecentRound.status === 'closed' ? mostRecentRound : null;

  const completedRounds = rounds.filter((r) => r.status === 'revealed' || r.status === 'cancelled');

  let votedCount = 0;
  let hasVoted = false;
  let voterStatus: { participantId: string; hasVoted: boolean }[] | undefined;
  let result: RoundResult | undefined;

  if (currentRound) {
    const voteRecords = await db.query.voteRecords.findMany({
      where: eq(schema.voteRecords.roundId, currentRound.id),
    });

    votedCount = voteRecords.length;
    hasVoted = voteRecords.some((r) => r.participantId === participant.id);

    if (participant.role === 'teller') {
      voterStatus = participants.map((p) => ({
        participantId: p.id,
        hasVoted: voteRecords.some((r) => r.participantId === p.id),
      }));
    }
  }

  // Get the most recent revealed round result (for display on Latest tab)
  // Only show if no active round is in progress
  if (!currentRound && !pendingRound) {
    const revealedRound = rounds.find((r) => r.status === 'revealed');
    if (revealedRound) {
      result = await getRoundResult(revealedRound, participants, participant.role === 'teller', election.bodySize);
    }
  }

  // Build round log
  const roundLog: RoundLogEntry[] = [];
  for (const round of completedRounds) {
    let logResult: RoundResult | null = null;
    if (round.status === 'revealed' && round.disclosureLevel !== 'none') {
      logResult = await getRoundResult(round, participants, participant.role === 'teller', election.bodySize);
    }
    roundLog.push({ round: formatRound(round), result: logResult });
  }

  return {
    election: {
      id: election.id,
      code: election.code,
      name: election.name,
      bodySize: election.bodySize,
      createdAt: election.createdAt.toISOString(),
      expiresAt: election.expiresAt.toISOString(),
    },
    participants: participants.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      joinedAt: p.createdAt.toISOString(),
    })),
    currentParticipantId: participant.id,
    isTeller: participant.role === 'teller',
    currentRound: currentRound ? formatRound(currentRound) : null,
    pendingRound: pendingRound ? formatRound(pendingRound) : null,
    votedCount,
    totalParticipants: participants.length,
    hasVoted,
    voterStatus,
    result,
    roundLog,
  };
}

async function getRoundResult(
  round: typeof schema.rounds.$inferSelect,
  participants: (typeof schema.participants.$inferSelect)[],
  isTeller: boolean,
  bodySize: number | null
): Promise<RoundResult> {
  const votes = await db.query.votes.findMany({
    where: eq(schema.votes.roundId, round.id),
  });

  const voteCounts = countVotes(votes);
  let tallies = buildTallies(voteCounts, participants);

  // Calculate majority based on bodySize if set, otherwise totalVotes
  const majorityBase = bodySize ?? votes.length;
  const topCount = tallies[0]?.count ?? 0;
  const hasWinnerMajority = hasMajority(topCount, majorityBase);
  const threshold = getMajorityThreshold(majorityBase);

  // Apply disclosure level - only show top candidates
  if (round.disclosureLevel === 'top' || round.disclosureLevel === 'top_no_count') {
    tallies = getTopCandidates(tallies);
  }

  return {
    round: formatRound(round),
    tallies,
    totalVotes: votes.length,
    hasMajority: hasWinnerMajority,
    majorityThreshold: threshold,
  };
}

function formatRound(round: typeof schema.rounds.$inferSelect) {
  return {
    id: round.id,
    office: round.office,
    description: round.description,
    status: round.status,
    disclosureLevel: round.disclosureLevel,
    createdAt: round.createdAt.toISOString(),
  };
}
