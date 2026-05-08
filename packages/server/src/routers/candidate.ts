import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { eq, and, desc, isNull, ne, sql } from 'drizzle-orm';
import { router, authedProcedure, tellerProcedure } from '../trpc.js';
import { db, schema } from '../db/index.js';
import {
  AddCandidateSchema,
  UpdateCandidateSchema,
  RemoveCandidateSchema,
} from '@officer-election/shared';
import type { Candidate } from '@officer-election/shared';
import { sseManager } from '../sse.js';

function formatCandidate(row: typeof schema.candidates.$inferSelect): Candidate {
  return {
    id: row.id,
    electionId: row.electionId,
    name: row.name,
    displayOrder: row.displayOrder,
    removedAt: row.removedAt,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadRoster(electionId: string): Promise<Candidate[]> {
  const rows = await db.query.candidates.findMany({
    where: eq(schema.candidates.electionId, electionId),
    orderBy: schema.candidates.displayOrder,
  });
  return rows.map(formatCandidate);
}

async function broadcastRoster(electionId: string) {
  const roster = await loadRoster(electionId);
  sseManager.broadcast(electionId, 'roster_updated', { candidates: roster });
}

export const candidateRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    return loadRoster(ctx.election.id);
  }),

  add: tellerProcedure
    .input(AddCandidateSchema)
    .mutation(async ({ input, ctx }) => {
      const name = input.name.trim();
      if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Name is required' });
      }

      const existing = await db.query.candidates.findFirst({
        where: and(
          eq(schema.candidates.electionId, ctx.election.id),
          isNull(schema.candidates.removedAt),
          sql`lower(${schema.candidates.name}) = lower(${name})`
        ),
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A candidate named "${existing.name}" already exists`,
        });
      }

      const last = await db.query.candidates.findFirst({
        where: eq(schema.candidates.electionId, ctx.election.id),
        orderBy: desc(schema.candidates.displayOrder),
      });

      const id = nanoid();
      const now = new Date();
      await db.insert(schema.candidates).values({
        id,
        electionId: ctx.election.id,
        name,
        displayOrder: (last?.displayOrder ?? 0) + 1,
        removedAt: null,
        createdAt: now,
      });

      await broadcastRoster(ctx.election.id);
      return { id };
    }),

  update: tellerProcedure
    .input(UpdateCandidateSchema)
    .mutation(async ({ input, ctx }) => {
      const name = input.name.trim();
      if (!name) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Name is required' });
      }

      const candidate = await db.query.candidates.findFirst({
        where: and(
          eq(schema.candidates.id, input.id),
          eq(schema.candidates.electionId, ctx.election.id)
        ),
      });
      if (!candidate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidate not found' });
      }

      const conflict = await db.query.candidates.findFirst({
        where: and(
          eq(schema.candidates.electionId, ctx.election.id),
          isNull(schema.candidates.removedAt),
          ne(schema.candidates.id, input.id),
          sql`lower(${schema.candidates.name}) = lower(${name})`
        ),
      });
      if (conflict) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A candidate named "${conflict.name}" already exists`,
        });
      }

      await db
        .update(schema.candidates)
        .set({ name })
        .where(eq(schema.candidates.id, input.id));

      await broadcastRoster(ctx.election.id);
      return { success: true };
    }),

  remove: tellerProcedure
    .input(RemoveCandidateSchema)
    .mutation(async ({ input, ctx }) => {
      const candidate = await db.query.candidates.findFirst({
        where: and(
          eq(schema.candidates.id, input.id),
          eq(schema.candidates.electionId, ctx.election.id)
        ),
      });
      if (!candidate) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Candidate not found' });
      }

      const referencingVote = await db.query.votes.findFirst({
        where: eq(schema.votes.candidateId, input.id),
      });

      if (referencingVote) {
        // Preserve historical name; just mark inactive.
        if (candidate.removedAt === null) {
          await db
            .update(schema.candidates)
            .set({ removedAt: Date.now() })
            .where(eq(schema.candidates.id, input.id));
        }
      } else {
        await db.delete(schema.candidates).where(eq(schema.candidates.id, input.id));
      }

      await broadcastRoster(ctx.election.id);
      return { success: true };
    }),
});
