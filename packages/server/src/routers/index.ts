import { router } from '../trpc.js';
import { electionRouter } from './election.js';
import { roundRouter } from './round.js';

export const appRouter = router({
  election: electionRouter,
  round: roundRouter,
});

export type AppRouter = typeof appRouter;
