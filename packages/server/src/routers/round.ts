import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { router, authedProcedure, tellerProcedure } from '../trpc.js';
import { db, schema } from '../db/index.js';
import {
  StartRoundSchema,
  VoteSchema,
  EndRoundSchema,
  CancelRoundSchema,
  CloseVotingSchema,
} from '@officer-election/shared';
import { sseManager } from '../sse.js';
import { getElectionState, countVotes, buildTallies, hasMajority, getMajorityThreshold } from '../utils.js';

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

      const roundId = nanoid();
      const now = new Date();

      await db.insert(schema.rounds).values({
        id: roundId,
        electionId: ctx.election.id,
        office: input.office,
        description: input.description || null,
        status: 'voting',
        createdAt: now,
      });

      const round = {
        id: roundId,
        office: input.office,
        description: input.description || null,
        status: 'voting' as const,
        disclosureLevel: null,
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

      // Validate candidate if not abstaining
      if (input.candidateId) {
        const candidate = await db.query.participants.findFirst({
          where: and(
            eq(schema.participants.id, input.candidateId),
            eq(schema.participants.electionId, ctx.election.id)
          ),
        });

        if (!candidate) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid candidate' });
        }
      }

      const now = new Date();

      // Insert vote (anonymous)
      await db.insert(schema.votes).values({
        id: nanoid(),
        roundId: input.roundId,
        candidateId: input.candidateId,
      });

      // Record that this participant voted
      await db.insert(schema.voteRecords).values({
        id: nanoid(),
        roundId: input.roundId,
        participantId: ctx.participant.id,
        votedAt: now,
      });

      // Get updated vote count
      const voteRecords = await db.query.voteRecords.findMany({
        where: eq(schema.voteRecords.roundId, input.roundId),
      });

      const participants = await db.query.participants.findMany({
        where: eq(schema.participants.electionId, ctx.election.id),
      });

      const votedCount = voteRecords.length;
      const totalParticipants = participants.length;

      // Broadcast vote status update
      sseManager.broadcast(ctx.election.id, 'vote_status', {
        roundId: input.roundId,
        votedCount,
        totalParticipants,
        voterStatus: participants.map((p) => ({
          participantId: p.id,
          hasVoted: voteRecords.some((r) => r.participantId === p.id),
        })),
      });

      // Auto-end if everyone voted
      if (votedCount === totalParticipants) {
        sseManager.broadcast(ctx.election.id, 'all_voted', { roundId: input.roundId });
      }

      return { success: true };
    }),

  closeVoting: tellerProcedure
    .input(CloseVotingSchema)
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

      // Update status to closed
      await db
        .update(schema.rounds)
        .set({ status: 'closed' })
        .where(eq(schema.rounds.id, input.roundId));

      // Calculate vote tallies for teller
      const votes = await db.query.votes.findMany({
        where: eq(schema.votes.roundId, input.roundId),
      });

      const participants = await db.query.participants.findMany({
        where: eq(schema.participants.electionId, ctx.election.id),
      });

      const voteCounts = countVotes(votes);
      const tallies = buildTallies(voteCounts, participants);

      // Calculate majority info (excluding abstentions - they can't "win")
      const majorityBase = ctx.election.bodySize || votes.length;
      const majorityThreshold = getMajorityThreshold(majorityBase);
      const actualVotes = tallies.filter((t) => t.candidateId !== null);
      const topCount = actualVotes[0]?.count || 0;
      const hasWon = hasMajority(topCount, majorityBase);

      // Broadcast that voting is closed (but not results)
      sseManager.broadcast(ctx.election.id, 'voting_closed', {
        roundId: input.roundId,
      });

      return {
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

      // For top_no_count, verify there's a majority winner
      if (input.disclosureLevel === 'top_no_count') {
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
