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
} from '@officer-election/shared';
import { sseManager } from '../sse.js';
import { getElectionState } from '../utils.js';

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

  end: tellerProcedure
    .input(EndRoundSchema)
    .mutation(async ({ input, ctx }) => {
      const round = await db.query.rounds.findFirst({
        where: and(
          eq(schema.rounds.id, input.roundId),
          eq(schema.rounds.electionId, ctx.election.id),
          eq(schema.rounds.status, 'voting')
        ),
      });

      if (!round) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Round not found' });
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
      const round = await db.query.rounds.findFirst({
        where: and(
          eq(schema.rounds.id, input.roundId),
          eq(schema.rounds.electionId, ctx.election.id),
          eq(schema.rounds.status, 'voting')
        ),
      });

      if (!round) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Round not found' });
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
