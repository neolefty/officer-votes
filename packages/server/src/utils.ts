import { eq, and, desc, sql } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import type { ElectionState, RoundLogEntry, RoundResult, VoteTally } from '@officer-election/shared';

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

  const currentRound = rounds.find((r) => r.status === 'voting') || null;
  const completedRounds = rounds.filter((r) => r.status !== 'voting');

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

  // Get revealed round result if exists
  const revealedRound = rounds.find((r) => r.status === 'revealed');
  if (revealedRound) {
    result = await getRoundResult(revealedRound, participants, participant.role === 'teller');
  }

  // Build round log
  const roundLog: RoundLogEntry[] = [];
  for (const round of completedRounds) {
    let logResult: RoundResult | null = null;
    if (round.status === 'revealed' && round.disclosureLevel !== 'none') {
      logResult = await getRoundResult(round, participants, participant.role === 'teller');
    }
    roundLog.push({ round: formatRound(round), result: logResult });
  }

  return {
    election: {
      id: election.id,
      code: election.code,
      name: election.name,
      createdAt: election.createdAt.toISOString(),
      expiresAt: election.expiresAt.toISOString(),
    },
    participants: participants.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      joinedAt: p.createdAt.toISOString(),
    })),
    currentRound: currentRound ? formatRound(currentRound) : null,
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
  isTeller: boolean
): Promise<RoundResult> {
  const votes = await db.query.votes.findMany({
    where: eq(schema.votes.roundId, round.id),
  });

  const tallyMap = new Map<string | null, number>();
  for (const vote of votes) {
    const key = vote.candidateId;
    tallyMap.set(key, (tallyMap.get(key) || 0) + 1);
  }

  let tallies: VoteTally[] = Array.from(tallyMap.entries()).map(([candidateId, count]) => ({
    candidateId,
    candidateName: candidateId
      ? participants.find((p) => p.id === candidateId)?.name || 'Unknown'
      : null,
    count,
  }));

  tallies.sort((a, b) => b.count - a.count);

  // Apply disclosure level
  if (round.disclosureLevel === 'top' && tallies.length > 0) {
    const topCount = tallies[0].count;
    tallies = tallies.filter((t) => t.count === topCount);
  }

  return {
    round: formatRound(round),
    tallies,
    totalVotes: votes.length,
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
