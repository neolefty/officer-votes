import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
import { router, authedProcedure, tellerProcedure } from '../trpc.js';
import { db, schema } from '../db/index.js';
import {
  StartRoundSchema,
  VoteSchema,
  ChangeVoteSchema,
  RetractVoteSchema,
  EndRoundSchema,
  CancelRoundSchema,
  CloseVotingSchema,
  SetRoundClosesAtSchema,
  selectWinners,
} from '@officer-election/shared';
import type { CloseVotingResult } from '@officer-election/shared';
import { sseManager } from '../sse.js';
import { getElectionState, countVotes, buildTallies, hasMajority, getMajorityThreshold } from '../utils.js';

// Validate that candidateId is a legal choice for this round. Pool depends on
// round.electionType: by_election => candidates roster (+ per-round eligibility),
// officer => the election's participants. Throws on an invalid choice.
async function validateCandidate(
  round: typeof schema.rounds.$inferSelect,
  candidateId: string,
  electionId: string
): Promise<void> {
  if (round.electionType === 'by_election') {
    const candidate = await db.query.candidates.findFirst({
      where: and(
        eq(schema.candidates.id, candidateId),
        eq(schema.candidates.electionId, electionId)
      ),
    });
    if (!candidate || candidate.removedAt !== null) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'This candidate is no longer eligible' });
    }
    if (round.eligibleCandidateIds) {
      const eligible = JSON.parse(round.eligibleCandidateIds) as string[];
      if (!eligible.includes(candidateId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This candidate is not eligible in the current round',
        });
      }
    }
  } else {
    const candidate = await db.query.participants.findFirst({
      where: and(
        eq(schema.participants.id, candidateId),
        eq(schema.participants.electionId, electionId)
      ),
    });
    if (!candidate || candidate.disqualifiedAt !== null) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid candidate' });
    }
  }
}

// "Ending soon" soft lock: once a teller-set closing time passes, vote
// changes/withdrawals are rejected but first-time votes stay accepted until
// closeVoting. Derived from the server clock at mutation time — not a round
// status — so there is no extra state transition to audit.
function requireNotLocked(round: { closesAt: number | null }): void {
  if (round.closesAt !== null && Date.now() >= round.closesAt) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Voting is closing soon — vote changes are locked',
    });
  }
}

// Disqualified voters may not cast, change, or retract a ballot. Re-reads the
// participant row rather than trusting ctx (which was loaded at request start)
// so a just-landed disqualification is seen — this is the loser-of-the-race
// resolver for DQ vs vote: disqualifyVoter sets disqualifiedAt before deleting
// the ballot, so a racing mutation is either rejected here or its ballot is
// swept up by the delete.
async function requireNotDisqualified(participantId: string): Promise<void> {
  const participant = await db.query.participants.findFirst({
    where: eq(schema.participants.id, participantId),
  });
  if (!participant || participant.disqualifiedAt !== null) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You have been disqualified from voting in this election',
    });
  }
}

// Recompute participation from voteRecords and broadcast vote_status to all
// clients. Counts adjust automatically for change (no-op count), withdraw, and
// disqualification (count drops; disqualified participants leave the
// denominator). Returns the fresh counts for the caller. Exported for
// election.disqualifyVoter, which retracts a ballot mid-round.
export async function broadcastVoteStatus(
  electionId: string,
  roundId: string
): Promise<{ votedCount: number; totalParticipants: number }> {
  const voteRecords = await db.query.voteRecords.findMany({
    where: eq(schema.voteRecords.roundId, roundId),
  });
  const participants = await db.query.participants.findMany({
    where: eq(schema.participants.electionId, electionId),
  });
  const active = participants.filter((p) => p.disqualifiedAt === null);

  const votedCount = voteRecords.length;
  const totalParticipants = active.length;

  sseManager.broadcast(electionId, 'vote_status', {
    roundId,
    votedCount,
    totalParticipants,
    voterStatus: active.map((p) => ({
      participantId: p.id,
      hasVoted: voteRecords.some((r) => r.participantId === p.id),
    })),
  });

  return { votedCount, totalParticipants };
}

// Insert a first-cast ballot only if the round is still open and the voter is
// not disqualified, as one atomic statement. A plain insert can interleave
// with closeVoting: the status guard reads 'voting', close flips status and
// nulls the linkage, then the insert lands — stranding a participant_id on a
// closed round and violating the anonymity invariant. The same shape covers a
// vote racing disqualifyVoter, whose ballot sweep would otherwise miss an
// insert landing just after it. SQLite serializes writers, so this either
// lands before close/DQ (and is nulled or swept with the rest) or sees the
// new state and no-ops. Returns whether the ballot landed.
export async function insertVoteIfRoundOpen(vote: {
  id: string;
  roundId: string;
  candidateId: string | null;
  participantId: string;
}): Promise<boolean> {
  const result = await db.run(sql`
    INSERT INTO votes (id, round_id, candidate_id, participant_id)
    SELECT ${vote.id}, ${vote.roundId}, ${vote.candidateId}, ${vote.participantId}
    WHERE EXISTS (SELECT 1 FROM rounds WHERE id = ${vote.roundId} AND status = 'voting')
      AND EXISTS (SELECT 1 FROM participants WHERE id = ${vote.participantId} AND disqualified_at IS NULL)
  `);
  // rows-affected is `.changes` on better-sqlite3 but `.rowsAffected` on libsql
  const affected = result as { changes?: number; rowsAffected?: number };
  return (affected.changes ?? affected.rowsAffected ?? 0) > 0;
}

export const roundRouter = router({
  start: tellerProcedure
    .input(StartRoundSchema)
    .mutation(async ({ input, ctx }) => {
      // Check no active round
      const activeRound = await db.query.rounds.findFirst({
        where: and(
          eq(schema.rounds.electionId, ctx.election.id),
          eq(schema.rounds.status, 'voting')
        ),
      });

      if (activeRound) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A voting round is already in progress',
        });
      }

      const electionType = ctx.election.electionType;

      let eligibleCandidateIds: string[] | null = null;
      if (input.eligibleCandidateIds && input.eligibleCandidateIds.length > 0) {
        if (electionType !== 'by_election') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'eligibleCandidateIds is only valid for by-elections',
          });
        }
        const activeCandidates = await db.query.candidates.findMany({
          where: and(
            eq(schema.candidates.electionId, ctx.election.id),
            isNull(schema.candidates.removedAt),
            inArray(schema.candidates.id, input.eligibleCandidateIds)
          ),
        });
        if (activeCandidates.length !== input.eligibleCandidateIds.length) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'One or more eligible candidates are not in the active roster',
          });
        }
        eligibleCandidateIds = input.eligibleCandidateIds;
      }

      const roundId = nanoid();
      const now = new Date();

      await db.insert(schema.rounds).values({
        id: roundId,
        electionId: ctx.election.id,
        office: input.office,
        description: input.description || null,
        electionType,
        eligibleCandidateIds: eligibleCandidateIds ? JSON.stringify(eligibleCandidateIds) : null,
        status: 'voting',
        createdAt: now,
      });

      const round = {
        id: roundId,
        office: input.office,
        description: input.description || null,
        electionType,
        eligibleCandidateIds,
        status: 'voting' as const,
        disclosureLevel: null,
        closesAt: null,
        createdAt: now.toISOString(),
      };

      sseManager.broadcast(ctx.election.id, 'round_started', round);

      return round;
    }),

  vote: authedProcedure
    .input(VoteSchema)
    .mutation(async ({ input, ctx }) => {
      const round = await db.query.rounds.findFirst({
        where: and(
          eq(schema.rounds.id, input.roundId),
          eq(schema.rounds.electionId, ctx.election.id),
          eq(schema.rounds.status, 'voting')
        ),
      });

      if (!round) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Round not found or not accepting votes',
        });
      }

      await requireNotDisqualified(ctx.participant.id);

      // Check if already voted
      const existingRecord = await db.query.voteRecords.findFirst({
        where: and(
          eq(schema.voteRecords.roundId, input.roundId),
          eq(schema.voteRecords.participantId, ctx.participant.id)
        ),
      });

      if (existingRecord) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You have already voted in this round',
        });
      }

      // Validate candidate if not abstaining. Pool depends on round.electionType.
      if (input.candidateId) {
        await validateCandidate(round, input.candidateId, ctx.election.id);
      }

      const now = new Date();

      // Insert vote with the ephemeral voter linkage so the voter can later
      // change/withdraw it. participantId is nulled at closeVoting and is never
      // included in any response or broadcast payload. Conditional on the round
      // still being open so a vote racing closeVoting can't strand a linked
      // ballot on a closed round.
      const inserted = await insertVoteIfRoundOpen({
        id: nanoid(),
        roundId: input.roundId,
        candidateId: input.candidateId,
        participantId: ctx.participant.id,
      });

      if (!inserted) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Voting just closed — your vote was not recorded',
        });
      }

      // Record that this participant voted
      await db.insert(schema.voteRecords).values({
        id: nanoid(),
        roundId: input.roundId,
        participantId: ctx.participant.id,
        votedAt: now,
      });

      // Broadcast updated participation.
      const { votedCount, totalParticipants } = await broadcastVoteStatus(
        ctx.election.id,
        input.roundId
      );

      // Teller nudge only: everyone currently on the roll has voted. Not an
      // auto-close — rolls grow over time and voters can now withdraw.
      if (votedCount === totalParticipants) {
        sseManager.broadcast(ctx.election.id, 'all_voted', { roundId: input.roundId });
      }

      return { success: true };
    }),

  changeVote: authedProcedure
    .input(ChangeVoteSchema)
    .mutation(async ({ input, ctx }) => {
      const round = await db.query.rounds.findFirst({
        where: and(
          eq(schema.rounds.id, input.roundId),
          eq(schema.rounds.electionId, ctx.election.id),
          eq(schema.rounds.status, 'voting')
        ),
      });

      if (!round) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Round not found or no longer accepting changes',
        });
      }

      requireNotLocked(round);
      await requireNotDisqualified(ctx.participant.id);

      // Must have an existing ballot in this round to change it.
      const existingRecord = await db.query.voteRecords.findFirst({
        where: and(
          eq(schema.voteRecords.roundId, input.roundId),
          eq(schema.voteRecords.participantId, ctx.participant.id)
        ),
      });

      if (!existingRecord) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You have not voted in this round yet',
        });
      }

      if (input.candidateId) {
        await validateCandidate(round, input.candidateId, ctx.election.id);
      }

      // Re-point this voter's ballot via the ephemeral linkage.
      await db
        .update(schema.votes)
        .set({ candidateId: input.candidateId })
        .where(
          and(
            eq(schema.votes.roundId, input.roundId),
            eq(schema.votes.participantId, ctx.participant.id)
          )
        );

      await db
        .update(schema.voteRecords)
        .set({ votedAt: new Date() })
        .where(eq(schema.voteRecords.id, existingRecord.id));

      // Count is unchanged, but broadcast so the tally view stays fresh.
      await broadcastVoteStatus(ctx.election.id, input.roundId);

      return { success: true };
    }),

  retractVote: authedProcedure
    .input(RetractVoteSchema)
    .mutation(async ({ input, ctx }) => {
      const round = await db.query.rounds.findFirst({
        where: and(
          eq(schema.rounds.id, input.roundId),
          eq(schema.rounds.electionId, ctx.election.id),
          eq(schema.rounds.status, 'voting')
        ),
      });

      if (!round) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Round not found or no longer accepting changes',
        });
      }

      requireNotLocked(round);
      await requireNotDisqualified(ctx.participant.id);

      const existingRecord = await db.query.voteRecords.findFirst({
        where: and(
          eq(schema.voteRecords.roundId, input.roundId),
          eq(schema.voteRecords.participantId, ctx.participant.id)
        ),
      });

      if (!existingRecord) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You have not voted in this round yet',
        });
      }

      // Delete the ballot (via the ephemeral linkage) and the participation
      // record, returning the voter to the not-voted state.
      await db
        .delete(schema.votes)
        .where(
          and(
            eq(schema.votes.roundId, input.roundId),
            eq(schema.votes.participantId, ctx.participant.id)
          )
        );

      await db.delete(schema.voteRecords).where(eq(schema.voteRecords.id, existingRecord.id));

      await broadcastVoteStatus(ctx.election.id, input.roundId);

      return { success: true };
    }),

  // Set, extend, or clear (null) the round's soft closing time on the fly.
  // "Lock now" = closesAt set to the current server time. The deadline never
  // closes voting by itself — the teller still clicks Close — it only locks
  // changes/withdrawals once passed (see requireNotLocked).
  setClosesAt: tellerProcedure
    .input(SetRoundClosesAtSchema)
    .mutation(async ({ input, ctx }) => {
      const round = await db.query.rounds.findFirst({
        where: and(
          eq(schema.rounds.id, input.roundId),
          eq(schema.rounds.electionId, ctx.election.id),
          eq(schema.rounds.status, 'voting')
        ),
      });

      if (!round) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Round not found or not in voting status' });
      }

      await db
        .update(schema.rounds)
        .set({ closesAt: input.closesAt })
        .where(eq(schema.rounds.id, input.roundId));

      sseManager.broadcast(ctx.election.id, 'round_updated', {
        roundId: input.roundId,
        closesAt: input.closesAt,
      });

      return { success: true };
    }),

  closeVoting: tellerProcedure
    .input(CloseVotingSchema)
    .mutation(async ({ input, ctx }): Promise<CloseVotingResult> => {
      const round = await db.query.rounds.findFirst({
        where: and(
          eq(schema.rounds.id, input.roundId),
          eq(schema.rounds.electionId, ctx.election.id),
          eq(schema.rounds.status, 'voting')
        ),
      });

      if (!round) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Round not found or not in voting status' });
      }

      // Close, then sever the ephemeral voter linkage (anonymize-on-finalization:
      // for any non-`voting` status, no vote row carries a participant_id).
      // Two sequential writes rather than one transaction: the dev (better-sqlite3,
      // sync) and prod (libsql, async) drivers have incompatible transaction
      // callback models, and the rest of this codebase is non-transactional.
      // Status flips first so change/retract (which require 'voting') stop being
      // accepted before the link is cleared.
      await db
        .update(schema.rounds)
        .set({ status: 'closed' })
        .where(eq(schema.rounds.id, input.roundId));
      await db
        .update(schema.votes)
        .set({ participantId: null })
        .where(eq(schema.votes.roundId, input.roundId));

      const votes = await db.query.votes.findMany({
        where: eq(schema.votes.roundId, input.roundId),
      });
      const voteCounts = countVotes(votes);

      // Broadcast that voting is closed (but not results)
      sseManager.broadcast(ctx.election.id, 'voting_closed', {
        roundId: input.roundId,
      });

      if (round.electionType === 'by_election') {
        const candidateRows = await db.query.candidates.findMany({
          where: eq(schema.candidates.electionId, ctx.election.id),
        });
        const nameById = new Map(candidateRows.map((c) => [c.id, c.name]));
        const tallies = buildTallies(voteCounts, nameById);
        const vacancyCount = ctx.election.vacancyCount ?? 1;
        const selection = selectWinners(tallies, vacancyCount);
        return {
          electionType: 'by_election',
          tallies,
          totalVotes: votes.length,
          selection,
          vacancyCount,
        };
      }

      const participants = await db.query.participants.findMany({
        where: eq(schema.participants.electionId, ctx.election.id),
      });
      const nameById = new Map(participants.map((p) => [p.id, p.name]));
      const tallies = buildTallies(voteCounts, nameById);

      // Calculate majority info (excluding abstentions - they can't "win")
      const majorityBase = ctx.election.bodySize || votes.length;
      const majorityThreshold = getMajorityThreshold(majorityBase);
      const actualVotes = tallies.filter((t) => t.candidateId !== null);
      const topCount = actualVotes[0]?.count || 0;
      const hasWon = hasMajority(topCount, majorityBase);

      return {
        electionType: 'officer',
        tallies,
        totalVotes: votes.length,
        majorityThreshold,
        hasMajority: hasWon,
        bodySize: ctx.election.bodySize,
      };
    }),

  end: tellerProcedure
    .input(EndRoundSchema)
    .mutation(async ({ input, ctx }) => {
      const round = await db.query.rounds.findFirst({
        where: and(
          eq(schema.rounds.id, input.roundId),
          eq(schema.rounds.electionId, ctx.election.id),
          eq(schema.rounds.status, 'closed')
        ),
      });

      if (!round) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Round not found or voting not closed yet' });
      }

      // Officer-only: top_no_count requires a majority winner. By-elections have no majority concept.
      if (round.electionType === 'officer' && input.disclosureLevel === 'top_no_count') {
        const votes = await db.query.votes.findMany({
          where: eq(schema.votes.roundId, input.roundId),
        });

        const voteCounts = countVotes(votes);
        const majorityBase = ctx.election.bodySize || votes.length;
        const topCount = Math.max(...voteCounts.values(), 0);

        if (!hasMajority(topCount, majorityBase)) {
          const baseDesc = ctx.election.bodySize
            ? `${ctx.election.bodySize}-member body`
            : `${votes.length} votes cast`;
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Cannot use "top without count" without a majority (>${Math.floor(majorityBase / 2)} of ${baseDesc}). Please choose another disclosure option.`,
          });
        }
      }

      await db
        .update(schema.rounds)
        .set({
          status: 'revealed',
          disclosureLevel: input.disclosureLevel,
        })
        .where(eq(schema.rounds.id, input.roundId));

      // Broadcast to all participants
      const state = await getElectionState(ctx.election, ctx.participant);
      sseManager.broadcast(ctx.election.id, 'round_ended', {
        round: { ...state.currentRound, status: 'revealed', disclosureLevel: input.disclosureLevel },
        result: state.result,
      });

      return { success: true };
    }),

  cancel: tellerProcedure
    .input(CancelRoundSchema)
    .mutation(async ({ input, ctx }) => {
      // Can cancel rounds in either 'voting' or 'closed' status
      const round = await db.query.rounds.findFirst({
        where: and(
          eq(schema.rounds.id, input.roundId),
          eq(schema.rounds.electionId, ctx.election.id)
        ),
      });

      if (!round || (round.status !== 'voting' && round.status !== 'closed')) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Round not found or already completed' });
      }

      await db
        .update(schema.rounds)
        .set({ status: 'cancelled' })
        .where(eq(schema.rounds.id, input.roundId));

      // Delete votes for this round
      await db.delete(schema.votes).where(eq(schema.votes.roundId, input.roundId));
      await db.delete(schema.voteRecords).where(eq(schema.voteRecords.roundId, input.roundId));

      sseManager.broadcast(ctx.election.id, 'round_cancelled', { roundId: input.roundId });

      return { success: true };
    }),
});
