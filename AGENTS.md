# Officer Election Voting App

Anonymous voting app for Bahá'í-style officer elections, with teller-controlled result
disclosure. pnpm monorepo:

- `packages/shared` — Zod schemas, types, and pure vote-counting logic (built first)
- `packages/server` — Express + tRPC + Drizzle ORM, SSE for real-time updates
- `packages/client` — React + Vite + Tailwind SPA (served by the server in prod)

SQLite in dev, Turso in prod.

## Commands

- `pnpm dev` — client + server in parallel
- `pnpm build` — builds shared → server → client (order matters; shared must build first)
- `pnpm test` / `pnpm test:watch` — Vitest
- `pnpm lint` / `pnpm lint:fix`
- `pnpm db:generate` / `pnpm db:migrate` — Drizzle migrations

## Conventions

- Import shared types/schemas from `@officer-election/shared`; don't redefine them locally.
- Pure vote-counting logic lives in `packages/shared/src/voting.ts` (`countVotes`,
  `buildTallies`, `hasMajority`, `getMajorityThreshold`, `getTopCandidates`, `selectWinners`),
  unit-tested in `voting.test.ts`. The server re-exports these via `src/utils.ts`.
- tRPC routers are in `packages/server/src/routers/`. Auth tiers (`src/trpc.ts`):
  `publicProcedure`, `authedProcedure` (any participant), `tellerProcedure` (teller-only).
  Pick the right tier for every procedure.
- Broadcast real-time updates with `sseManager.broadcast(electionId, event, data)` (`src/sse.ts`).
- Migrations are hand-rolled in `packages/server/src/db/migrate.ts` (additive `ALTER` /
  `CREATE TABLE IF NOT EXISTS`), not drizzle-kit. Schema changes must update it.

## Data model (`packages/server/src/db/schema.ts`)

- **Election** — 6-char `code`, `name`, optional `bodySize`, `expiresAt`. `electionType` is
  `officer` or `by_election`; by-elections add `vacancyCount`.
- **Participant** — belongs to an election; `role` is `teller` or `voter`; unique auth `token`.
- **Candidate** — by-election roster (distinct from participants); soft-deleted via `removedAt`.
- **Round** — one office/contest; `status` flows `voting → closed → revealed` (or `cancelled`).
  Carries a `disclosureLevel`, and for runoffs an `eligibleCandidateIds` subset.
- **Vote** — anonymous; `candidateId` null = abstain.
- **VoteRecord** — tracks *who* voted (not how), for participation display.

## Domain rules

- **Anonymity invariant:** `votes.participantId` is written only while a round is `voting`, so a
  voter can change or retract their ballot. It is **nulled at `closeVoting`** and must never
  appear in any response or SSE payload. Preserve this whenever touching vote/round code.
- **Officer vs by-election:** officer elections draw candidates from participants and require a
  majority winner; by-elections use the Candidate roster and select top-N up to `vacancyCount`,
  with runoff/tie handling.
- **Majority** = more than half (> 50%) of the base, where base = `election.bodySize` if set,
  else total votes cast.
- **Disclosure levels:** `top` (top vote-getters with counts), `top_no_count` (winner only,
  requires majority — officer-only, rejected for by-elections), `all` (full tally), `none`.
- **Voting flow:** teller starts a round → participants vote/abstain (and may change or retract
  while open) → teller closes → reviews results privately → picks a disclosure level → results
  revealed accordingly.

Design docs for in-flight work live in `*_PLAN.md` / `*_DESIGN.md` at the repo root (note:
several phases there are planned, not yet shipped).

## PR previews

Every open non-fork PR gets a live test instance at
`https://pr-<number>.preview.wlbahai.org` (keyed link in a sticky PR comment),
deployed by a reconciler on the home server within ~3 minutes of a push and torn
down on close. See `scripts/preview/README.md` for architecture and operations.
Previews are keyed on PR number, so branch names need no DNS-related conventions.
For interactive multi-device testing of a change, push a PR and use its preview
link rather than localhost.

## Review guidelines

- Flag any code path that could leak `votes.participantId` or otherwise tie a ballot to a
  voter as **P0**.
- Flag missing or wrong auth tiers on tRPC procedures (`authedProcedure` vs `tellerProcedure`)
  as **P1**.
- Scrutinize vote-counting, majority, and winner-selection math in
  `packages/shared/src/voting.ts`; require test coverage for changes there (**P1**).
- Flag disclosure-level handling that ignores the officer/by-election constraints above (**P1**).
- Flag schema changes not reflected in `migrate.ts` (**P1**).
