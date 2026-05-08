import { router } from '../trpc.js';
import { electionRouter } from './election.js';
import { roundRouter } from './round.js';
import { candidateRouter } from './candidate.js';

export const appRouter = router({
  election: electionRouter,
  round: roundRouter,
  candidate: candidateRouter,
});

export type AppRouter = typeof appRouter;
