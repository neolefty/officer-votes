import { initTRPC, TRPCError } from '@trpc/server';
import type { Request } from 'express';
import { db, schema } from './db/index.js';
import { eq } from 'drizzle-orm';

export interface Context {
  req: Request;
  participant: typeof schema.participants.$inferSelect | null;
  election: typeof schema.elections.$inferSelect | null;
}

export async function createContext({ req }: { req: Request }): Promise<Context> {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return { req, participant: null, election: null };
  }

  const participant = await db.query.participants.findFirst({
    where: eq(schema.participants.token, token),
  });

  if (!participant) {
    return { req, participant: null, election: null };
  }

  const election = await db.query.elections.findFirst({
    where: eq(schema.elections.id, participant.electionId),
  });

  return { req, participant, election: election ?? null };
}

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.participant || !ctx.election) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      ...ctx,
      participant: ctx.participant,
      election: ctx.election,
    },
  });
});

export const tellerProcedure = authedProcedure.use(async ({ ctx, next }) => {
  if (ctx.participant.role !== 'teller') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Teller access required' });
  }
  return next({ ctx });
});
