import { TRPCError } from '@trpc/server';
import { nanoid, customAlphabet } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { router, publicProcedure, authedProcedure, tellerProcedure } from '../trpc.js';
import { db, schema } from '../db/index.js';
import {
  CreateElectionSchema,
  JoinElectionSchema,
  PromoteToTellerSchema,
  SetBodySizeSchema,
  ELECTION_CODE_LENGTH,
  TOKEN_LENGTH,
  ELECTION_EXPIRY_DAYS,
} from '@officer-election/shared';
import { sseManager } from '../sse.js';
import { getElectionState } from '../utils.js';
import { maybeCleanupExpired } from '../cleanup.js';

const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', ELECTION_CODE_LENGTH);
const generateToken = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', TOKEN_LENGTH);

export const electionRouter = router({
  create: publicProcedure
    .input(CreateElectionSchema)
    .mutation(async ({ input }) => {
      const id = nanoid();
      const code = generateCode();
      const token = generateToken();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ELECTION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      await db.insert(schema.elections).values({
        id,
        code,
        name: input.name,
        bodySize: input.bodySize ?? null,
        createdAt: now,
        expiresAt,
      });

      // Creator becomes first teller
      const participantId = nanoid();
      await db.insert(schema.participants).values({
        id: participantId,
        electionId: id,
        name: input.tellerName,
        role: 'teller',
        token,
        createdAt: now,
      });

      return { code, token };
    }),

  join: publicProcedure
    .input(JoinElectionSchema)
    .mutation(async ({ input }) => {
      const election = await db.query.elections.findFirst({
        where: eq(schema.elections.code, input.code.toUpperCase()),
      });

      if (!election) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Election not found' });
      }

      if (new Date() > election.expiresAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Election has expired' });
      }

      const token = generateToken();
      const participantId = nanoid();
      const now = new Date();

      await db.insert(schema.participants).values({
        id: participantId,
        electionId: election.id,
        name: input.name,
        role: 'voter',
        token,
        createdAt: now,
      });

      // Notify existing participants
      sseManager.broadcast(election.id, 'participant_joined', {
        id: participantId,
        name: input.name,
        role: 'voter',
        joinedAt: now.toISOString(),
      });

      return { token };
    }),

  // Rejoin with existing token - just validates and returns state
  rejoin: publicProcedure
    .input(JoinElectionSchema.pick({ code: true }).extend({ token: JoinElectionSchema.shape.name.optional() }))
    .mutation(async ({ input, ctx }) => {
      const token = ctx.req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }

      const participant = await db.query.participants.findFirst({
        where: eq(schema.participants.token, token),
      });

      if (!participant) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid token' });
      }

      const election = await db.query.elections.findFirst({
        where: eq(schema.elections.id, participant.electionId),
      });

      if (!election || election.code !== input.code.toUpperCase()) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      return { valid: true };
    }),

  get: authedProcedure.query(async ({ ctx }) => {
    // Lazy cleanup of expired elections
    maybeCleanupExpired();
    return getElectionState(ctx.election, ctx.participant);
  }),

  updateName: authedProcedure
    .input(JoinElectionSchema.pick({ name: true }))
    .mutation(async ({ input, ctx }) => {
      await db
        .update(schema.participants)
        .set({ name: input.name })
        .where(eq(schema.participants.id, ctx.participant.id));

      sseManager.broadcast(ctx.election.id, 'participant_updated', {
        id: ctx.participant.id,
        name: input.name,
      });

      return { success: true };
    }),

  promoteToTeller: tellerProcedure
    .input(PromoteToTellerSchema)
    .mutation(async ({ input, ctx }) => {
      const target = await db.query.participants.findFirst({
        where: and(
          eq(schema.participants.id, input.participantId),
          eq(schema.participants.electionId, ctx.election.id)
        ),
      });

      if (!target) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      await db
        .update(schema.participants)
        .set({ role: 'teller' })
        .where(eq(schema.participants.id, input.participantId));

      sseManager.broadcast(ctx.election.id, 'participant_updated', {
        id: input.participantId,
        role: 'teller',
      });

      return { success: true };
    }),

  stepDownAsTeller: tellerProcedure.mutation(async ({ ctx }) => {
    // Ensure at least one teller remains
    const tellers = await db.query.participants.findMany({
      where: and(
        eq(schema.participants.electionId, ctx.election.id),
        eq(schema.participants.role, 'teller')
      ),
    });

    if (tellers.length <= 1) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot step down: you are the only teller',
      });
    }

    await db
      .update(schema.participants)
      .set({ role: 'voter' })
      .where(eq(schema.participants.id, ctx.participant.id));

    sseManager.broadcast(ctx.election.id, 'participant_updated', {
      id: ctx.participant.id,
      role: 'voter',
    });

    return { success: true };
  }),

  setBodySize: tellerProcedure
    .input(SetBodySizeSchema)
    .mutation(async ({ input, ctx }) => {
      await db
        .update(schema.elections)
        .set({ bodySize: input.bodySize })
        .where(eq(schema.elections.id, ctx.election.id));

      sseManager.broadcast(ctx.election.id, 'election_updated', {
        bodySize: input.bodySize,
      });

      return { success: true };
    }),
});
