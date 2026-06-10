# Long-Running Elections — Plan

Two features that together make the app safe for elections that live for
**weeks** (by-elections, distributed sign-up) instead of **minutes**
(in-meeting officer elections):

1. **Vote cancellation** — a voter can change or withdraw their own vote;
   a teller can disqualify a voter and have their ballot retracted, even
   mid-round.
2. **Google sign-in** — one identity = one participant per election, so a
   person can rejoin from another device without creating a duplicate.

## Why they belong together

There is **no central voter database** — anyone with the link + a name
joins. That is the source of the double-vote risk we hit running a real
by-election. The two features attack it from opposite ends:

- **Google auth dedups at the source.** A returning user re-binds to their
  existing `participants` row instead of spawning a second one.
- **Cancel / disqualify is the backstop.** For what auth can't catch
  (anonymous joiners, two different Google accounts, wrong-jurisdiction
  sign-ups), the teller retracts. "Teller agility instead of a roster."
- **Closing-time + end-election** give the teller control over a round
  that is now alive for weeks rather than minutes.

We treat authenticated and unauthenticated participants **equally** — auth
is additive, not required. Tellers may be either.

## Decisions (locked)

- **Closing time = soft lock + manual close.** When a teller-set closing
  time passes, vote changes/withdrawals lock ("ending soon"), but voting
  stays **open** and the teller must still click Close. New first-time
  votes are still accepted until Close (last call).
- **Self-change allowed in both election types**, any time the round is
  open and not locked.
- **Sequencing: cancellation + lifecycle first, Google auth last.**
- **No hot-deploy safety required.** No election is currently live, so ship
  all phases together and reset/rewrite the DB as needed rather than gating
  each phase behind an additive-only migration. The phase split below is just
  PR/review ordering. (The repo's deploy-safety pattern still governs future
  changes made while an election *is* live.)

## Prior art in this repo

- `SOCIAL_AUTH_PLAN.md` (alongside this file) — the detailed Phase 5 spec;
  adopt mostly as-is. Its rollout section is trimmed to match the
  "no hot-deploy safety" decision above.
- `disqualify-voter` branch — an earlier, somewhat-aligned attempt
  (between-rounds-only `participants.disqualifiedAt`, disqualify/reinstate).
  **Treat it as disposable history.** None of that DQ code is on `main`, and
  Phase 2 below does **not** build on it — it builds the mid-round version
  fresh on `main`. The verification matrix in Testing focus below stands on
  its own; don't go fishing the branch for it.

---

## The keystone: ephemeral vote→voter linkage

Today votes are **structurally anonymous**: `votes` holds only
`(roundId, candidateId)`; `voteRecords` separately records *who voted*
(not what). To locate "this person's ballot" for change / withdraw /
retract, we add an **ephemeral** link:

```ts
// packages/server/src/db/schema.ts — votes
participantId: text('participant_id'),
// ephemeral: written while the round is `voting`, NULLed at closeVoting.
// Never appears in any tRPC response or SSE payload.
```

**Framing.** This shifts the model from *structural anonymity* (today: the
schema makes voter→vote linkage impossible) to *anonymize-on-finalization*
(after Phase 1: linkage is possible-but-transient, severed at
`closeVoting`). That is a real change to the property even though it nets
out fine for the threat model. "Tellers are trustworthy" is the
load-bearing assumption that makes it acceptable; it is no longer a
footnote. One operational consequence worth naming: any DB backup taken
mid-round (production snapshots, dev pulls) contains the linkage — so it
informs ops decisions, not just code.

**Anonymity guarantee.** Content is never sent to tellers through the app
(no payload ever carries `participantId` on a vote). After a round closes,
the link is nulled, so at-rest anonymity matches today exactly. The only
cost — during an *open* round a DB-admin could correlate — is bounded by
the "ending soon" lock and is acceptable under "tellers are trustworthy."
`voteRecords` already records participation permanently; we are only adding
the *content* link, and only transiently.

**Standing invariant (make it a test):** for any round where
`status != 'voting'`,
`SELECT count(*) FROM votes WHERE round_id = ? AND participant_id IS NOT NULL`
must be `0`. This covers `closed`, `revealed`, **and `cancelled`** — every
non-`voting` transition must sever the link in the same transaction that
changes status. `closeVoting` severs it by *nulling* the column (votes are
kept for the tally). The `cancel` path already severs it more bluntly by
*deleting* the round's `votes` rows outright (`round.ts` `cancel`), so the
invariant holds there for free — keep it that way; any future switch from
delete→null on cancel must then null the link, or this regresses.

---

## Phase 1 — Linkage + voter self-service change/withdraw

**Schema / migration** (`schema.ts`, `migrate.ts`): add `votes.participant_id`
to the `votes` `CREATE TABLE` in `migrate.ts`, with a try/catch
`ALTER TABLE votes ADD COLUMN participant_id TEXT` so an existing dev DB picks
it up. Nothing is live to protect, so just delete the DB and let it recreate
if that's ever simpler.

**Server** (`routers/round.ts`):
- `vote` (existing): on insert also write `participantId: ctx.participant.id`.
  Keep the "already voted" guard — first cast only. Guard the insert against a
  concurrent close so a late ballot can't strand a non-null `participant_id` on
  an already-closed round (see *Race / ordering rules → first-cast vote vs
  close*).
- `changeVote` (new, `authedProcedure`): require `status==='voting'`, not
  locked, and an existing `voteRecord`. Validate candidate. `UPDATE votes
  SET candidate_id = ? WHERE round_id = ? AND participant_id = ?`; bump
  `voteRecords.votedAt`. Broadcast `vote_status`. (Phase 2 adds a
  `participant.disqualifiedAt == null` guard here once that column exists —
  see Phase 2 — so a just-disqualified voter can't mutate their ballot
  before the deletion lands.)
- `retractVote` (new): same guards; delete the voter's `votes` row and
  `voteRecords` row; broadcast `vote_status`. Returns voter to not-voted.
  (Same Phase-2 `disqualifiedAt` guard applies.)
- `closeVoting` (existing): after tally work, `UPDATE votes SET
  participant_id = NULL WHERE round_id = ?` — in the same transaction that
  sets `status='closed'`, so change/retract (which require `voting`) can't
  race past it. The `cancel` path needs no change: it already deletes the
  round's `votes` rows, satisfying the invariant for `cancelled`.

**Shared** (`schemas.ts`): `ChangeVoteSchema { roundId, candidateId|null }`,
`RetractVoteSchema { roundId }`.

**Client**: on the post-vote waiting view (`pages/Election.tsx`) add
"Change vote" and "Withdraw vote" actions (hidden when locked/closed). The
`hasVoted` / `votedCount` / `voterStatus` plumbing already recomputes from
`voteRecords`, so counts adjust for free. Demote the `all_voted` auto-signal
to a teller nudge only (people can now un-vote; rolls also grow over time).

**UX asymmetry (intentional).** Anonymous voters can change/withdraw only
from the device that cast the ballot — `changeVote` is `authedProcedure`
and there is nothing besides the bearer token to identify them. Logged-in
voters get cross-device change/withdraw because their `userId` provides
recovery. This is the strongest per-session UX argument for Phase 5, and a
natural consequence of "auth is additive."

---

## Phase 2 — Mid-round disqualify (built fresh on `main`)

No DQ code exists on `main` (see Prior art). Phase 2 builds the mid-round
version from scratch — there are no old guards to remove.

**Schema / migration** (`schema.ts`, `migrate.ts`): add
`participants.disqualified_at INTEGER` (unix ms; null = active), with a
try/catch `ALTER TABLE participants ADD COLUMN disqualified_at INTEGER` so
an existing dev DB picks it up.

**Server** (`routers/round.ts`): wire the new column into every voter
mutation — reject when `ctx.participant.disqualifiedAt != null` in `vote`,
`changeVote`, and `retractVote`. This is the `disqualifiedAt` guard the
Phase 1 bullets forward-reference; it lands here because the column is new
in this phase, and it doubles as the loser-of-the-race resolver below.

**Server** (`routers/election.ts`): add `disqualifyVoter` and
`reinstateVoter`, both new `tellerProcedure`s.

`disqualifyVoter`:
1. Self-guard (a teller can't disqualify themselves) and teller-guard
   (refuse to disqualify a `teller`-role row — demote to voter first).
2. Set `disqualifiedAt` **first** (so any in-flight `vote` is rejected by
   the `round.ts` guard above — the loser-of-the-race resolver).
3. If a `voting` round exists, delete the target's `votes` row (by
   `participantId`, the Phase-1 link) and `voteRecords` row; recompute and
   broadcast `vote_status`. A `closed` round's votes are already nulled and
   counted — DQ then only marks the participant; it does **not** alter the
   closed tally.

`reinstateVoter`: just clear `disqualifiedAt`. Their ballot was deleted on
DQ; if reinstated while the round is still open & unlocked they can vote
fresh (their `voteRecord` was deleted too).

**Client** (`Lobby.tsx`): add disqualify / reinstate teller controls,
mid-round-capable from the start (no "disabled while a round is in
progress" state). Make the Disqualify confirm copy conditional — if the
target has voted in the current round, warn "their vote will be retracted
and cannot be recovered," else the plain copy.

---

## Phase 3 — Round closing time + "ending soon" lock

**Schema / migration**: `rounds.closes_at INTEGER` (timestamp, nullable).
**No new round status** — "locked / ending-soon" is a *derived* sub-state of
`voting` (`isLocked = closesAt != null && serverNow >= closesAt`). This keeps
the blast radius tiny: no audit of every `status==='voting'` check.

**Server**:
- `setRoundClosesAt` (new, `tellerProcedure`) `{ roundId, closesAt|null }`:
  set/extend/clear on the fly; broadcast `round_updated`. "Lock now" =
  set `closesAt = serverNow`.
- Enforce `!isLocked` in `changeVote` / `retractVote` (server is authority).
  `vote` (first cast) stays allowed until `closeVoting` (soft lock = voting
  stays open).
- Include a `serverNow` field in the `getElectionState` payload so clients
  run the countdown without trusting local clock skew.

**Close is terminal.** `closeVoting` nulls the linkage; there is no reopen
path. A teller who closed too early has two options: (a) cancel the round
(which deletes its votes — see the standing invariant) and start a new one,
or (b) live with the result. Reopening would mean re-issuing voter→vote
linkage for already-cast ballots, which has no clean story.

**Client**: countdown + "Voting closing soon — changes are locked" banner
when `closesAt` is set/passed; hide change/withdraw once locked; teller
controls to set / extend / clear the time and a "Lock now" button.

---

## Phase 4 — Explicit "End election"

**Schema / migration**: `elections.ended_at INTEGER` (nullable).

**Server** (`routers/election.ts`):
- `endElection` (new, `tellerProcedure`): require no `voting`/`closed` round
  in progress (close/reveal first); set `endedAt`; broadcast
  `election_ended`. Reversible via clearing `endedAt` (tellers trusted).
- Guard `join`, `vote`, `changeVote`, `retractVote`, `round.start` to reject
  when `endedAt != null` (mirrors the existing expiry guard).

Three clocks stay distinct and must not be conflated:
`ELECTION_EXPIRY_DAYS` (GC backstop) · `rounds.closesAt` (per-round soft
deadline) · `elections.endedAt` (whole-election finalization).

**Client**: "End election" teller action; read-only summary once ended.

---

## Phase 5 — Google sign-in (adopt SOCIAL_AUTH_PLAN.md)

Schema-independent of Phases 1–4. Per `SOCIAL_AUTH_PLAN.md`:

- `users` table; nullable `participants.userId` + `participants.lastSeenAt`.
- Express (non-tRPC) `GET /auth/google` + `/auth/google/callback`
  (generic callback URL; signed-state JWT carrying intent/electionCode).
- **Recover flow** (no token): find `participants` by `(electionId, userId)`
  → return that bearer token. **Link flow** (in session): set `userId`.
- **Dedup = the anti-double-vote property:** enforce one participant per
  `(electionId, userId)` in the handler.
- **Known gap (Phase 2 covers it):** someone who joined *anonymously* then
  clicks "Continue with Google" can't be auto-matched to their anonymous
  row, so a duplicate can still appear unless they explicitly link in
  session — exactly what teller-disqualify mops up.
- Presence (`lastSeenAt` + SSE "active now") as a teller aid for spotting
  duplicates in a long election.
- Env-flagged: routes 404 and the button hides if OAuth is unconfigured;
  a boot-time server log line and a dev-only homepage footer point the
  developer at `docs/google-oauth-setup.md` (see SOCIAL_AUTH_PLAN.md →
  *Unconfigured OAuth*).

---

## Cross-cutting

**Race / ordering rules**
- DQ vs vote: set `disqualifiedAt` → then delete ballot; `vote` checks
  `disqualifiedAt`. Either the vote lands and is deleted, or it's rejected.
- change/retract vs close: `closeVoting` sets `status='closed'` first, then
  nulls links, as two ordered sequential writes (NOT one transaction — see the
  driver gotcha under Deploy). change/retract require `voting` → rejected once
  status flips.
- **first-cast vote vs close** *(the one ordering the status-flip-first trick
  does NOT cover — added after Phase 1 review).* A `vote` whose status-guard
  read precedes `closeVoting`'s `status='closed'` write, but whose `INSERT`
  lands *after* the link-nulling write, inserts a brand-new row the null-update
  already passed over — leaving a `closed` round holding a vote with a non-null
  `participant_id`, violating the standing invariant. Unlike change/retract,
  the new row isn't gated by re-checking status, so flipping status first
  doesn't help. Real on prod (libsql async interleaves at `await`s); narrower
  but still present in dev (better-sqlite3 yields at `await` boundaries too).
  **Fix (preferred): make the insert conditional on the round in one atomic
  statement** —
  `INSERT INTO votes (…) SELECT … WHERE EXISTS (SELECT 1 FROM rounds WHERE id=? AND status='voting')` —
  then inspect rows-affected; if `0`, skip the `voteRecords` insert and reject
  with `CONFLICT` ("Voting just closed — your vote was not recorded"). SQLite
  serializes writers, so this either lands-before-close (then gets nulled) or
  sees `closed` and no-ops; no transient row ever exists. Driver wrinkle:
  rows-affected is `.changes` on better-sqlite3 vs `.rowsAffected` on libsql —
  read both. **Fallback (pure Drizzle, no raw SQL):** insert, re-read the
  round, and if `status !== 'voting'` delete the row *by its generated `id`*
  (not by `participant_id`, which close may have already nulled) plus its
  `voteRecord`, then throw the same `CONFLICT`. Preserves the invariant but
  briefly materializes the row. Either way the user sees an error and can
  retry if the round is in fact still open.
- change/retract vs lock: enforced from `serverNow` at mutation time; a
  sub-second skew window is acceptable.

**Deploy** — no election is live, so migrations don't need to be hot-safe.
Land the phases together; reset or rewrite the DB freely instead of threading
every change through an additive `ALTER` and gating each phase behind its own
column. (`migrate.ts` is a hand-rolled boot script of `CREATE TABLE IF NOT
EXISTS` + try/catch `ALTER`s — already does a table rewrite for `rounds` — so
table rewrites are fine.) The repo's general deploy-safety pattern
(additive-nullable `ALTER`s, snapshot-to-branch) still governs *future* work
done while an election is live; it just doesn't constrain this change.

**Migration mechanism — decision: adopt `drizzle-kit` (DEFERRED, not yet done).**
The hand-rolled `migrate.ts` is sufficient for Phases 1–5 (additive columns +
new tables, resettable DB), so we are *not* blocking this work on it. But it
carries real liabilities worth retiring once the phase churn settles:
- **Dual source of truth.** `schema.ts` (Drizzle defs the app queries through)
  and `migrate.ts` (raw SQL) are maintained by hand in parallel and can drift
  silently — nearly happened with `election_type`/`vacancy_count`, and had to be
  kept in sync by hand again for Phase 1's `votes.participant_id`.
- **`catch {}` swallows everything**, not just "duplicate column" — a genuinely
  broken migration fails silently and only surfaces as runtime query errors.
- **CHECK-constraint changes need manual full-table rewrites** (SQLite), already
  hand-done once for `rounds`.

Chosen direction (when picked up): add `drizzle-kit` + a `drizzle.config.ts`,
`generate` an initial baseline matching the current DB and mark it applied, then
switch `db:migrate` to `drizzle-kit migrate`. This makes `schema.ts` the single
source of truth with versioned, tracked migrations across both drivers.

**Related driver gotcha (already in effect):** do **not** use `db.transaction`
across the dev `better-sqlite3` (sync) / prod `libsql` (async) split — an
`async` callback silently escapes a better-sqlite3 transaction, committing
before the awaited writes resolve. Phase 1's `closeVoting` therefore severs the
voter linkage with two ordered sequential writes (status→`closed` first, then
null `participant_id`) rather than a transaction; the standing invariant still
holds under "tellers trusted" + the sub-second-race tolerance above.

**Testing focus**
- The at-rest anonymity invariant above (any non-`voting` status →
  `participant_id IS NULL` for that round, including `cancelled`).
- **In-transit anonymity:** a snapshot-style test over `getElectionState`,
  `vote_status`, and round-result payloads asserting `participantId` is
  absent from every vote-shaped object in the response.
- change → re-tally; withdraw → count drops; mid-round DQ → count drops and
  victim's choice absent from the eventual tally.
- Lock: change/withdraw rejected after `closesAt`; first cast still accepted;
  extending `closesAt` re-opens changes.
- Ended election rejects join/vote/start.
- DQ guards: self-disqualify and disqualifying a teller-role row both rejected.
- Reinstate mid-round → the voter can vote fresh (their `voteRecord` was
  deleted on DQ, so the "already voted" guard no longer blocks them).
- Past-round name resolution: disqualifying someone whose name appears in an
  already-revealed tally still renders their name (`nameById` resolves from
  the full participants table, not the active set).
- DQ-vs-vote race: with a `vote` in flight as the teller disqualifies, the
  ballot either lands-then-gets-deleted or is rejected — and post-close
  `participant_id IS NULL` still holds with no orphan ballot.

## Out of scope (future)
Required auth; surfacing email to tellers; magic-link / non-Google
providers; account-merge UI; "my elections" dashboard; rate-limited /
spam-resistant sign-up.

**Cryptographic vote anonymity** (blind signatures, mixnets, on-client
encrypted ballot tokens stored in Drive AppData) is explicitly out of
scope — a deliberate rejection, not an oversight. Anonymize-on-finalization
was chosen for compatibility with first-class unauthenticated use and
mid-vote anonymous→logged-in transitions, both of which break under
blind-signature protocols: the signing step requires authenticated
authorization, and there is no clean way for a freshly-logged-in user to
"claim" an anonymous ballot without revealing how they voted.
