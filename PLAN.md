# Officer Election App - Implementation Plan

## Architecture
- pnpm monorepo: `packages/{server,client,shared}`
- Server: Express + tRPC + Drizzle ORM
- Client: React + Vite + Tailwind + tRPC client
- DB: SQLite (dev) / Turso or Neon (prod) via Drizzle
- Real-time: SSE
- Deploy: Cloud Run + Cloud Build

## Data Model
```
Election { id, code (6-char), name, createdAt, expiresAt }
Participant { id, electionId, name, role (teller|voter), token, createdAt }
Round { id, electionId, office, description, status (pending|voting|revealed|cancelled), disclosureLevel (top|all|none), createdAt }
Vote { id visibleid, roundId, candidateId (nullable=abstain) }
VoteRecord { roundId, participantId, votedAt }
```

## tRPC Routes
- `election.create` → { code, tellerToken }
- `election.join` → { participantToken, election, participants }
- `election.get` → election state (participants, current round, log)
- `election.invite` (teller) → adds participant slot? or just share URL
- `round.start` (teller) → { office, description }
- `round.cancel` (teller)
- `round.end` (teller) → { disclosureLevel }
- `round.vote` → { candidateId | null for abstain }
- `round.status` → SSE stream

## Build Order
1. Scaffold monorepo + packages
2. shared: Zod schemas, types, constants
3. server: Express + tRPC skeleton
4. server: Drizzle schema + SQLite
5. server: Core routes (create, join, get)
6. client: Vite + React + Tailwind shell
7. client: tRPC client setup
8. client: Join/create flows
9. server: Round routes (start, vote, end)
10. server: SSE for real-time
11. client: Voting UI
12. client: Results/log UI
13. Dockerfile
14. Cloud Run config

## UI Screens
- `/` — Create election (name) → redirect to `/e/[code]`
- `/e/[code]` — Join (enter name) or rejoin (token in localStorage)
- `/e/[code]` (joined) — Lobby: see participants, wait for round
- `/e/[code]` (voting) — Vote UI: select candidate or abstain
- `/e/[code]` (voted) — Waiting: "4/7 voted"
- `/e/[code]` (revealed) — Results based on disclosureLevel
- Election log: sidebar/modal

## Teller-specific UI
- Start round button (office name input)
- End round early (confirm dialog)
- Cancel round
- See who voted (not what)
- Promote voter to teller

## Open items
- Exact SSE event format
- Token generation (nanoid)
- Expiry cleanup (lazy on access)
