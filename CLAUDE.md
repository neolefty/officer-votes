# Claude Code Context

## Project Overview
Officer election voting app for Bahá'í-style elections. Supports anonymous voting with teller-controlled result disclosure.

## Architecture
- **Monorepo**: pnpm workspace with `packages/{client,server,shared}`
- **Server**: Express + tRPC + Drizzle ORM + SSE for real-time
- **Client**: React + Vite + Tailwind + tRPC client
- **Database**: SQLite (dev) / Turso (prod) via Drizzle

## Key Commands
```bash
pnpm dev          # Run client + server in parallel
pnpm build        # Build all packages (shared → server → client)
pnpm start        # Start production server
pnpm db:migrate   # Run database migrations
```

## Package Structure
- `packages/shared/` - Zod schemas, TypeScript types (built first)
- `packages/server/` - Express API, tRPC routers, database
- `packages/client/` - React SPA, served by Express in production

## Code Conventions
- Vote counting utilities are in `server/src/utils.ts` (countVotes, buildTallies, hasMajority, etc.)
- tRPC routers in `server/src/routers/` - use `authedProcedure` for voters, `tellerProcedure` for teller-only actions
- SSE events broadcast via `sseManager.broadcast(electionId, event, data)`
- Types should be imported from `@officer-election/shared`, not redefined locally

## Data Model
- **Election**: Has a 6-char code, name, optional body size, expiration
- **Participant**: Belongs to election, has role (teller/voter), auth token
- **Round**: Voting round for an office, statuses: voting → closed → revealed
- **Vote**: Anonymous vote (candidateId or null for abstain)
- **VoteRecord**: Tracks who voted (not what) for participation display

## Voting Flow
1. Teller starts round (office name)
2. Participants vote or abstain
3. Teller closes voting → sees results privately
4. Teller chooses disclosure level (top/top_no_count/all/none)
5. Results revealed to all based on disclosure

## Disclosure Levels
- `top` - Show top vote-getters with counts
- `top_no_count` - Show winner only (requires majority)
- `all` - Show all candidates with counts
- `none` - Don't disclose results

## Majority Calculation
Majority = more than half of the base (> 50%). Base is `election.bodySize` if set, otherwise total votes cast.
