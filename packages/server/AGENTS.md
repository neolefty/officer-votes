# packages/server

Express + tRPC + Drizzle, with SSE for real-time. Routers in `src/routers/`, auth tiers in
`src/trpc.ts`, schema in `src/db/schema.ts`, hand-rolled migrations in `src/db/migrate.ts`,
real-time in `src/sse.ts`.

## Conventions

- Every tRPC procedure must use the correct auth tier: `publicProcedure`, `authedProcedure`
  (any participant), or `tellerProcedure` (teller-only). State-changing election/round mutations
  are almost always teller-only.
- The DB runs on `better-sqlite3` in dev and libsql/Turso in prod. Migrations must be additive
  and work on both drivers; update `migrate.ts` for every schema change.
- SSE payloads go to every participant — they may contain only non-sensitive, already-disclosable
  data.

## Review guidelines

- **P0:** any response or `sseManager.broadcast` payload that exposes `votes.participantId`, the
  ballot→voter linkage, or undisclosed tallies/results. That link is written only while a round is
  `voting` and must be nulled at `closeVoting`; flag any path that persists or leaks it.
- **P1:** a state-changing procedure on the wrong auth tier (e.g. a teller action reachable via
  `authedProcedure`).
- **P1:** schema changes not mirrored in `migrate.ts`, or migrations that aren't additive / break
  on one of the two drivers.
- **P1:** disclosure logic that returns more than the chosen `disclosureLevel` permits, or that
  applies `top_no_count` to a by-election.
