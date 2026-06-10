# Testing Plan — Long-Running Elections

Concrete test cases + the harness they need, expanding the high-level
**Testing focus** checklist in `LONG_RUNNING_ELECTIONS_PLAN.md` (which spans
all five phases) into something runnable. Cases are tagged by the phase that
unlocks them: **[P1]** is implementable against the code on `main` today;
**[P2]**–**[P5]** are blocked until those phases land.

## Current state

- Only `packages/shared/src/voting.test.ts` exists — pure-function unit tests
  for `countVotes` / `buildTallies` / `hasMajority` / `selectWinners`.
- `pnpm test` runs `vitest run` at the root; vitest is already a dev dep.
- **There is no server-side test harness.** Everything in `routers/` is
  untested, so all the Phase-1 ballot-mutation behavior is uncovered.

## Two test tiers

1. **Pure unit (no DB).** Already the model in `voting.test.ts`. Cheap, fast.
   Anything we can express as a pure predicate should live here.
2. **Router integration (real SQLite + tRPC caller).** The bulk of Phase 1 —
   change / withdraw / close / anonymity — is stateful and only meaningful
   against the DB. This needs net-new infrastructure (below).

## Required infrastructure (net-new, prerequisite for [P1] integration tests)

The blocker is that `db` is a module-level singleton created via top-level
`await` in `db/index.ts`, and `migrate.ts` runs its `CREATE TABLE`s as a
side-effecting script against its *own* connection. To test routers we need:

1. **Refactor `migrate.ts` → export `runMigrations(db)`.** Move the
   `db.run(sql\`CREATE TABLE …\`)` / `ALTER` block into a function that takes a
   Drizzle instance. The CLI script becomes `runMigrations(await createDb())`;
   tests call it against an isolated DB. (This also pays down the dual-source
   drift the plan flags — one place builds the schema.)
2. **Isolated DB per test file.** Point `db` at an in-memory or temp-file
   SQLite *before* server modules import — e.g. a vitest `setupFiles` that sets
   `process.env.DATABASE_URL = ':memory:'`, or a `makeTestDb()` helper that
   builds a fresh `better-sqlite3(':memory:')` + `drizzle()` and runs
   `runMigrations`. Because `db` is a singleton, either run with vitest's
   per-file isolation (default) or `DELETE FROM` every table in `beforeEach`.
3. **Seed + caller helpers.** A `seed()` that inserts an election, N
   participants (one teller), and an optional `voting` round; and
   `caller(participant)` = `appRouter.createCaller({ req: {} as any,
   participant, election })`. `tellerProcedure` tests pass a `role: 'teller'`
   participant; `authedProcedure` tests any participant; unauth tests pass
   `participant: null` and expect `UNAUTHORIZED`.

Put these in `packages/server/src/test/harness.ts`. Suggested test files:
`routers/round.vote.test.ts`, `routers/round.change-withdraw.test.ts`,
`routers/round.close.test.ts`, `anonymity.test.ts`.

---

## [P1] Cases — implementable now

### A. Change / withdraw happy paths
1. **change re-points the ballot** — vote A, `changeVote`→B; the round tally
   counts B and not A; `votedCount` unchanged; the `voteRecords.votedAt` is
   bumped.
2. **change to abstain** — vote A, `changeVote`→`null`; A's count drops,
   abstain count rises; voter still counts as having voted.
3. **change from abstain to a candidate** — the mirror of #2.
4. **withdraw drops the count** — vote A, `retractVote`; `votedCount` −1, no
   `votes` row for that participant, `voteRecords` row gone.
5. **withdraw returns voter to not-voted** — after #4, the same participant can
   `vote` again without hitting the "already voted" guard.

### B. Guards
6. `changeVote` with no prior ballot → `BAD_REQUEST` ("not voted yet").
7. `retractVote` with no prior ballot → `BAD_REQUEST`.
8. `changeVote` on a `closed` round → `NOT_FOUND` (status flipped).
9. `retractVote` on a `closed` round → `NOT_FOUND`.
10. `changeVote` to a candidate that doesn't exist → `BAD_REQUEST`
    (`validateCandidate`).
11. **by-election eligibility** — `changeVote` to a `removedAt != null`
    candidate, and to one not in `round.eligibleCandidateIds`, both rejected.
12. `changeVote` / `retractVote` from an unauthed context → `UNAUTHORIZED`
    (one case each; confirms they're `authedProcedure`).

### C. Anonymity invariants (the load-bearing ones — plan §"keystone")
13. **At-rest after close** — after `closeVoting`, every `votes` row for the
    round has `participant_id IS NULL`, *and* the tally is unchanged (votes are
    kept, only the link is severed). This is the standing invariant as a test.
14. **At-rest after cancel** — after `cancel`, the round has zero `votes` rows
    (so the invariant holds vacuously); assert `count = 0`.
15. **Positive control** — during a `voting` round, the voter's `votes` row
    *does* carry `participant_id` (proves the linkage is actually written, so
    #13 isn't passing trivially).
16. **In-transit** — `getElectionState`, the `vote_status` SSE payload, and the
    `closeVoting` result contain no `participantId` on any vote/tally-shaped
    object. Implement as a recursive key scan. **Note:** `voterStatus[]`
    legitimately carries `participantId` (that's *participation*, not vote
    content) — scope the assertion to vote/tally objects, not the whole blob.

### D. Close ordering / the vote-vs-close race
17. **change/retract lose the race to close** — after `closeVoting`, a
    `changeVote`/`retractVote` → `NOT_FOUND`. (Confirms status-flips-first.)
18. **first-cast vote vs close** *(tests the fix in
    `LONG_RUNNING_ELECTIONS_PLAN.md` §Race rules)* — white-box ordering: drive
    `vote` past its status-guard read while the round is `voting`, run
    `closeVoting` to completion, then let `vote` finish its write. Assert the
    late vote is **rejected** (`CONFLICT`) **and** invariant #13 still holds —
    no `votes` row with a non-null `participant_id` survives on the closed
    round, and no orphan ballot. Best driven by calling the guard/insert steps
    in a controlled order rather than relying on real concurrency (sync
    better-sqlite3 makes true interleaving hard to provoke).

### Optional pure-unit extraction
- If the race fix is implemented as a predicate (e.g. `canAcceptFirstCast` or a
  conditional-insert wrapper), unit-test it with no DB.

---

## Deferred — gated on later phases (from the plan's Testing focus)

- **[P2] DQ guards** — self-disqualify rejected; disqualifying a `teller`-role
  row rejected.
- **[P2] mid-round DQ** — count drops and the victim's choice is absent from
  the eventual tally; a `closed` round's tally is *not* altered by a later DQ.
- **[P2] reinstate mid-round** — the voter can vote fresh (their `voteRecord`
  was deleted on DQ, so "already voted" no longer blocks them).
- **[P2] DQ-vs-vote race** — vote in flight as teller disqualifies: ballot
  lands-then-deleted or is rejected; post-close `participant_id IS NULL` holds.
- **[P2] past-round name resolution** — disqualifying someone whose name is in
  an already-revealed tally still renders their name (`nameById` resolves from
  the full participants table).
- **[P3] lock** — change/withdraw rejected after `closesAt`; first cast still
  accepted; extending `closesAt` re-opens changes; `serverNow` drives it.
- **[P4] ended election** — rejects `join` / `vote` / `changeVote` /
  `retractVote` / `round.start`.
- **[P5] auth** — recover binds to existing `(electionId, userId)`; dedup
  enforced; `lastSeenAt` throttle; presence on connect/disconnect; unconfigured
  OAuth 404s routes and `config` returns `oauthConfigured: false`.
</content>
</invoke>
