# Officer Election

A real-time voting application for officer elections, designed for Bahá'í-style anonymous voting with teller-controlled result disclosure.

**Live instance:** https://vote.midwestbahai.org/

## Features

- **Anonymous voting** - Votes are recorded separately from voter identity
- **Real-time updates** - SSE-powered live vote count and status
- **Flexible disclosure** - Teller chooses what results to share (winner only, top candidates, all results, or none)
- **Body size support** - Optional fixed body size for majority calculation
- **Mobile-friendly** - Responsive design works on any device

## Quick Start

### Prerequisites
- Node.js 20+
- pnpm

### Development

```bash
# Install dependencies
pnpm install

# Run development servers (client + server)
pnpm dev
```

The client runs on `http://localhost:5173` and proxies API requests to the server on port 3000.

### Production Build

```bash
# Build all packages
pnpm build

# Start production server
pnpm start
```

The server serves both the API and the built client on port 3000.

## Project Structure

```
packages/
├── client/     # React + Vite + Tailwind frontend
├── server/     # Express + tRPC + Drizzle backend
└── shared/     # Shared types and Zod schemas
```

## How It Works

### Creating an Election
1. Go to the home page
2. Enter an election name and your name (you become the teller)
3. Share the 6-character code with participants

### Joining an Election
1. Go to `/e/[CODE]` or enter the code on the home page
2. Enter your name to join
3. Wait for the teller to start a voting round

### Voting Process
1. **Teller starts a round** - Specifies the office being voted on
2. **Participants vote** - Select a candidate or abstain
3. **Teller ends voting** - Sees private results
4. **Teller discloses results** - Chooses what to share with participants

### Disclosure Options
- **Top with count** - Shows who got the most votes and how many
- **Top only** - Shows the winner without vote counts (requires majority)
- **All results** - Shows everyone's vote counts
- **Don't disclose** - Completes round without sharing results

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `DATABASE_URL` | SQLite database path | `election.db` |
| `TURSO_DATABASE_URL` | Turso database URL (production) | - |
| `TURSO_AUTH_TOKEN` | Turso auth token | - |

## Deployment

### Docker

```bash
docker build -t officer-election .
docker run -p 3000:3000 officer-election
```

### Docker Compose

```bash
docker compose up
```

### Google Cloud Run

The project includes `cloudbuild.yaml` for Cloud Build deployment. Push to trigger a build and deploy to Cloud Run.

## Tech Stack

- **Frontend**: React, Vite, Tailwind CSS, TanStack Query
- **Backend**: Express, tRPC, Drizzle ORM
- **Database**: SQLite (dev) / Turso (prod)
- **Real-time**: Server-Sent Events (SSE)

## License

MIT - see [LICENSE](LICENSE)
