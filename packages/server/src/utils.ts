import { eq, desc } from 'drizzle-orm';
import { db, schema } from './db/index.js';
import {
  buildTallies,
  countVotes,
  getMajorityThreshold,
  getTopCandidates,
  hasMajority,
  selectWinners,
} from '@officer-election/shared';
import type {
  Candidate,
  Election,
  ElectionState,
  RoundLogEntry,
  RoundResult,
  VoteTally,
  WinnerSelection,
} from '@officer-election/shared';

export { buildTallies, countVotes, getMajorityThreshold, getTopCandidates, hasMajority };

export async function getElectionState(
  election: typeof schema.elections.$inferSelect,
  participant: typeof schema.participants.$inferSelect
): Promise<ElectionState> {
  const participants = await db.query.participants.findMany({
    where: eq(schema.participants.electionId, election.id),
    orderBy: schema.participants.createdAt,
  });

  // Disqualified participants stay in the list (so tellers can reinstate and
  // past tallies resolve names) but leave the participation denominator.
  const activeParticipants = participants.filter((p) => p.disqualifiedAt === null);

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
      voterStatus = activeParticipants.map((p) => ({
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
      result = await getRoundResult(revealedRound, participants, participant.role === 'teller', election);
    }
  }

  // Build round log
  const roundLog: RoundLogEntry[] = [];
  for (const round of completedRounds) {
    let logResult: RoundResult | null = null;
    if (round.status === 'revealed' && round.disclosureLevel !== 'none') {
      logResult = await getRoundResult(round, participants, participant.role === 'teller', election);
    }
    roundLog.push({ round: formatRound(round), result: logResult });
  }

  const electionBase = {
    id: election.id,
    code: election.code,
    name: election.name,
    bodySize: election.bodySize,
    createdAt: election.createdAt.toISOString(),
    expiresAt: election.expiresAt.toISOString(),
  };

  let electionResponse: Election;
  if (election.electionType === 'by_election') {
    const candidateRows = await db.query.candidates.findMany({
      where: eq(schema.candidates.electionId, election.id),
      orderBy: schema.candidates.displayOrder,
    });
    const candidates: Candidate[] = candidateRows.map((row) => ({
      id: row.id,
      electionId: row.electionId,
      name: row.name,
      displayOrder: row.displayOrder,
      removedAt: row.removedAt,
      createdAt: row.createdAt.toISOString(),
    }));
    electionResponse = {
      ...electionBase,
      electionType: 'by_election',
      vacancyCount: election.vacancyCount ?? 1,
      candidates,
    };
  } else {
    electionResponse = {
      ...electionBase,
      electionType: 'officer',
      vacancyCount: null,
    };
  }

  return {
    election: electionResponse,
    participants: participants.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      disqualifiedAt: p.disqualifiedAt,
      joinedAt: p.createdAt.toISOString(),
    })),
    currentParticipantId: participant.id,
    isTeller: participant.role === 'teller',
    currentRound: currentRound ? formatRound(currentRound) : null,
    pendingRound: pendingRound ? formatRound(pendingRound) : null,
    votedCount,
    totalParticipants: activeParticipants.length,
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
  election: typeof schema.elections.$inferSelect
): Promise<RoundResult> {
  const votes = await db.query.votes.findMany({
    where: eq(schema.votes.roundId, round.id),
  });
  const voteCounts = countVotes(votes);

  if (round.electionType === 'by_election') {
    // Include soft-deleted candidates so historical results can still resolve names.
    const candidateRows = await db.query.candidates.findMany({
      where: eq(schema.candidates.electionId, election.id),
    });
    const nameById = new Map(candidateRows.map((c) => [c.id, c.name]));
    let tallies = buildTallies(voteCounts, nameById);
    const vacancyCount = election.vacancyCount ?? 1;
    let selection = selectWinners(tallies, vacancyCount);

    // Disclosure filtering for non-teller view: limit visible tallies
    // to the candidates surfaced by the selection. For top_no_count, also
    // zero out counts on the selection so they don't leak over the wire.
    if (round.disclosureLevel === 'top' || round.disclosureLevel === 'top_no_count') {
      const visibleIds = new Set<string>();
      if (selection.outcome === 'decisive') {
        for (const w of selection.winners) {
          if (w.candidateId) visibleIds.add(w.candidateId);
        }
      } else if (selection.outcome === 'tie') {
        for (const w of selection.decisiveWinners) {
          if (w.candidateId) visibleIds.add(w.candidateId);
        }
        for (const t of selection.tiedCandidates) {
          if (t.candidateId) visibleIds.add(t.candidateId);
        }
      }
      tallies = tallies.filter((t) => t.candidateId !== null && visibleIds.has(t.candidateId));
      if (round.disclosureLevel === 'top_no_count') {
        selection = redactCounts(selection);
      }
    }

    return {
      electionType: 'by_election',
      round: formatRound(round),
      tallies,
      totalVotes: votes.length,
      selection,
      vacancyCount,
    };
  }

  const nameById = new Map(participants.map((p) => [p.id, p.name]));
  let tallies: VoteTally[] = buildTallies(voteCounts, nameById);

  // Calculate majority based on bodySize if set, otherwise totalVotes
  // Use top non-abstention vote count for majority check (abstentions can't "win")
  const majorityBase = election.bodySize ?? votes.length;
  const actualVotes = tallies.filter((t) => t.candidateId !== null);
  const topCount = actualVotes[0]?.count ?? 0;
  const hasWinnerMajority = hasMajority(topCount, majorityBase);
  const threshold = getMajorityThreshold(majorityBase);

  // Apply disclosure level - only show top candidates
  if (round.disclosureLevel === 'top' || round.disclosureLevel === 'top_no_count') {
    tallies = getTopCandidates(tallies);
  }

  return {
    electionType: 'officer',
    round: formatRound(round),
    tallies,
    totalVotes: votes.length,
    hasMajority: hasWinnerMajority,
    majorityThreshold: threshold,
  };
}

function redactCounts(selection: WinnerSelection): WinnerSelection {
  if (selection.outcome === 'decisive') {
    return {
      outcome: 'decisive',
      winners: selection.winners.map((w) => ({ ...w, count: 0 })),
    };
  }
  if (selection.outcome === 'tie') {
    return {
      outcome: 'tie',
      decisiveWinners: selection.decisiveWinners.map((w) => ({ ...w, count: 0 })),
      tiedCandidates: selection.tiedCandidates.map((t) => ({ ...t, count: 0 })),
      seatsContested: selection.seatsContested,
    };
  }
  return selection;
}

function formatRound(round: typeof schema.rounds.$inferSelect) {
  return {
    id: round.id,
    office: round.office,
    description: round.description,
    electionType: round.electionType,
    eligibleCandidateIds: round.eligibleCandidateIds
      ? (JSON.parse(round.eligibleCandidateIds) as string[])
      : null,
    status: round.status,
    disclosureLevel: round.disclosureLevel,
    createdAt: round.createdAt.toISOString(),
  };
}
