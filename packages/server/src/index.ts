import express from 'express';
import cors from 'cors';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './routers/index.js';
import { createContext } from './trpc.js';
import { sseManager } from './sse.js';
import { db, schema } from './db/index.js';
import { eq } from 'drizzle-orm';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// tRPC
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: ({ req }) => createContext({ req }),
  })
);

// SSE endpoint
app.get('/events/:code', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const participant = await db.query.participants.findFirst({
    where: eq(schema.participants.token, token),
  });

  if (!participant) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  const election = await db.query.elections.findFirst({
    where: eq(schema.elections.id, participant.electionId),
  });

  if (!election || election.code !== req.params.code.toUpperCase()) {
    res.status(404).json({ error: 'Election not found' });
    return;
  }

  sseManager.addClient(election.id, participant.id, res);
});

// Serve static files in production
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/trpc') && !req.path.startsWith('/events')) {
    res.sendFile(path.join(clientDist, 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { appRouter };
export type { AppRouter } from './routers/index.js';
