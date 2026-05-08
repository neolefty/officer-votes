# By-Election Support — Implementation Plan

## What this is

The app supports **officer elections** (Chair/Vice-Chair/Secretary/Treasurer; candidate pool = the 9 Assembly members; majority required). A **by-election** fills a vacancy: candidate pool is the broader community, top-N wins by count, no majority required, ties at the cutoff trigger a runoff restricted to tied candidates.

One codebase, two modes, switched by an `electionType` flag on `elections` and `rounds`. v1 is single-vacancy, pre-seeded roster (no write-ins, no mass import).

---

## Next steps (in order)

### 1. `RoundResult` discriminated union — **DONE**

Shipped:

- `RoundResult` is a discriminated union by `electionType` in `packages/shared/src/types.ts`.
- `getRoundResult` in `packages/server/src/utils.ts` stamps `electionType: 'officer'` (hardcoded; will branch on `round.electionType` once step 2 lands).
- `RoundResults.tsx` narrows on `electionType` before reading `hasMajority`/`majorityThreshold`. By-election arm is `return null` until step 4 fills it in.

Note: the plan called out three consumers; in practice only `RoundResults.tsx` needed narrowing. `EndRoundModal.tsx` reads `CloseVotingResult` (not `RoundResult`), and `ElectionLog.tsx` touches only shared fields. They'll likely take by-election copy in step 4.

### 2. Schema + migration — **DONE**

Shipped:

- **DB columns** (`packages/server/src/db/schema.ts`): `elections.election_type` (NOT NULL DEFAULT `'officer'`), `elections.vacancy_count` (nullable); `rounds.election_type` (denormalized, NOT NULL DEFAULT `'officer'`), `rounds.eligible_candidate_ids` (JSON-encoded text, nullable). Comment on `votes` documents that `candidateId` is interpreted against the parent round's `electionType`.
- **`candidates` table** with `candidates_election_idx`, exactly per the spec.
- **Migration** (`migrate.ts`): idempotent `ALTER TABLE … ADD COLUMN` in try/catch for the four new columns, `CREATE TABLE IF NOT EXISTS candidates`, `CREATE INDEX IF NOT EXISTS`. Verified against the populated dev DB — existing officer rows backfilled to `'officer'` automatically.
- **Shared types** (`packages/shared/src/types.ts`): `Election` gains `electionType` + `vacancyCount`; `Round` gains `electionType` + `eligibleCandidateIds`; new `Candidate`. **Zod schemas** (`schemas.ts`): `ElectionType` enum; `CreateElectionSchema` + `electionType` (default `'officer'`) + `vacancyCount`; `StartRoundSchema` + `eligibleCandidateIds`; new `AddCandidateSchema`, `UpdateCandidateSchema`, `RemoveCandidateSchema`.
- **`getRoundResult`** now reads `round.electionType` from the row instead of hardcoding it. By-election arm throws (`'by-election round results not yet implemented'`) so the officer branch narrows cleanly until step 4 fills it in. `formatRound` surfaces `electionType` + parses `eligibleCandidateIds` JSON. `getElectionState` includes `electionType` + `vacancyCount` in the election object.
- **`round.ts:start`** got a minimal stub patch (`electionType: 'officer' as const, eligibleCandidateIds: null`) so the new `Round` shape typechecks. Real inheritance/validation is step 4.

Note: `election.ts:create` was *not* touched — Drizzle's column defaults make `electionType`/`vacancyCount` optional on insert. Step 3 will explicitly pass them through so users can actually create by-elections.

### 3. `candidate.ts` router + roster mutations — **DONE**

Shipped:

- **New `candidate.ts` router** (`packages/server/src/routers/candidate.ts`), mounted in `routers/index.ts` as `candidate`. All mutations scoped to `ctx.election.id`.
  - `list` (authedProcedure) → full roster including soft-deleted, sorted by `displayOrder`.
  - `add` (tellerProcedure) → trim, reject empty, case-insensitive uniqueness against **active** rows only (re-adding a removed name is fine), `displayOrder = max + 1`.
  - `update` (tellerProcedure) → trim, reject empty, case-insensitive uniqueness scoped to other active rows, allowed even when `removedAt` is set (typo fix on historical name).
  - `remove` (tellerProcedure) → soft-delete by default; **hard-delete only when no `votes` row references the candidate**. Idempotent — second remove on an already-soft-deleted row with no votes will hard-delete it.
- **SSE**: every mutation broadcasts `roster_updated` to both tellers and voters with the **full roster snapshot** (`{ candidates: Candidate[] }`). Clients replace state wholesale.
- **`election.create`** now persists `electionType` from input and `vacancyCount` (server-side default `1` for by-elections when omitted; `null` for officer).
- **Shared `Election` type** refactored into a discriminated union (`packages/shared/src/types.ts`):
  ```ts
  type Election = ElectionBase & (
    | { electionType: 'officer';     vacancyCount: null }
    | { electionType: 'by_election'; vacancyCount: number; candidates: Candidate[] }
  );
  ```
  `bodySize` stays on `ElectionBase`. Officer arm has no `candidates`; by-election arm guarantees both `vacancyCount: number` and `candidates: Candidate[]`.
- **`getElectionState`** branches on `election.electionType`: by-election arm runs a candidates query and returns the populated array; officer arm skips the query and returns `vacancyCount: null` with no `candidates` field. The DB row stays flat — the union is response-shape only.

Note: no server-side guard yet against calling `candidate.*` on an officer election. Step 4 will add the `electionType === 'by_election'` guard alongside the round-level branching, since that's where it's actually consumed.

### 4. `round.ts` branching + UI — **DONE**

Shipped:

#### Server

- **`round.ts:start`** inherits `electionType` from `ctx.election`, validates `eligibleCandidateIds` against the active roster (rejects with `BAD_REQUEST` if any ID is removed/not in this election), persists JSON-encoded array to `rounds.eligibleCandidateIds`. Rejects `eligibleCandidateIds` on officer rounds.
- **`round.ts:vote`** branches on `round.electionType`. Officer → existing `participants` lookup. By-election → checks `candidates` table; rejects soft-deleted as "this candidate is no longer eligible"; if `round.eligibleCandidateIds` is non-null, validates membership. Abstain (`null`) still accepted in both modes.
- **`round.ts:closeVoting`** now returns the discriminated `CloseVotingResult`. Officer arm = existing majority calc. By-election arm = builds tallies against the candidates table and runs `selectWinners(tallies, vacancyCount)`.
- **`round.ts:end`** scopes the `top_no_count` majority guard to officer rounds only. By-elections accept any disclosure unconditionally.
- **`utils.ts:getRoundResult`** by-election arm: loads candidates **including soft-deleted** for name resolution, runs `selectWinners`, returns `{ electionType: 'by_election', selection, vacancyCount, tallies, ... }`. Disclosure filtering: `top`/`top_no_count` shrinks `tallies` to just the candidates surfaced by `selection`; `top_no_count` additionally zeros vote counts in the `selection` payload so they don't leak to non-tellers. Signature changed: now takes the full `election` row instead of just `bodySize`, since by-elections need `vacancyCount`.
- **`CloseVotingResult`** in `packages/shared/src/types.ts` is now a discriminated union by `electionType`. Officer arm carries `majorityThreshold`/`hasMajority`/`bodySize`; by-election arm carries `selection`/`vacancyCount`.

#### Client

- **`Home.tsx`**: radio for "Officer election" / "By-election (fill a vacancy)". By-election hides `bodySize` and hardcodes `vacancyCount: 1` on submit. Placeholder text differs per mode.
- **`CandidateRoster.tsx`** (new): teller add/rename/soft-delete (with confirmation prompts during open voting); voters see read-only list. Removed candidates collapsed under a `<details>` block. Voting-active banner ("changes will appear to voters live"). Mounted in `Lobby.tsx` only when `state.election.electionType === 'by_election'`. The Body Size panel is now hidden for by-elections.
- **`StartRoundModal.tsx`**: takes `electionType` and optional `runoff: { candidateNames, candidateIds }`. Defaults: officer = blank field "Office / Position"; by-election fresh = "Vote for vacancy"; by-election runoff = `"Runoff: Alice vs. Bob"` for 2 / `"Runoff: Alice, Bob, Carol"` for 3+. When `runoff` is set, shows "Restricted to: Alice, Bob" panel and sends `eligibleCandidateIds` on submit.
- **`VotingRound.tsx`**: now takes the full `state` and computes its own option list. Officer = participants. By-election = `state.election.candidates` filtered to active, intersected with `round.eligibleCandidateIds` when set. Runoff banner above the candidate list when applicable. Renders empty-state copy when no eligible candidates exist.
- **`EndRoundModal.tsx`**: teller results view branches on `results.electionType`. Officer view unchanged; by-election view tags rows as "Elected"/"Tied" off `selection`, no majority line. Default disclosure: officer = top_no_count when majority/top otherwise, by-election = top. New `onTieRunoff` callback fires after a successful `end` when the by-election outcome was a tie, so `TellerControls` can open `StartRoundModal` pre-filled. Disclosure copy adapts ("winner(s)" vs "top recipient(s)") and the by-election arm doesn't gate `top_no_count`.
- **`TellerControls.tsx`**: plumbs `electionType` and runoff-prefill state. After a tie, `EndRoundModal` closes and `StartRoundModal` opens automatically with the tied roster pre-filled.
- **`RoundResults.tsx`**: split into officer vs. by-election renderers. By-election renders `selection.outcome` as "Elected: …" / "Tied — runoff required for N seat(s): …" / "No votes cast.", with optional vote counts gated on `disclosureLevel === 'top'`. Runoff badge above the tally.
- **`ElectionLog.tsx`**: per-row "Runoff" badge for by-election runoff rounds. Disclosed-rounds body uses "Elected" / "Tied (runoff required)" labels for by-election entries instead of the officer top-recipient layout.
- **`Election.tsx`**: plumbing only — passes `state` (instead of `participants`) into `VotingRound`.

**Verified:** `pnpm build` clean across all three packages, `pnpm test` 30/30 voting tests pass, `pnpm lint` clean.

---

## Reference

### Type shapes (`packages/shared/src/`)

```ts
// types.ts
ElectionType = z.enum(['officer', 'by_election'])
Election:  discriminated union by electionType (refactored in step 3)
             officer     → { ..., vacancyCount: null }
             by_election → { ..., vacancyCount: number, candidates: Candidate[] }
Round:    + electionType, eligibleCandidateIds: string[] | null
Candidate: { id, electionId, name, displayOrder, removedAt: number | null, createdAt }
RoundResult: discriminated union by electionType (see step 1)

// schemas
CreateElectionSchema:    + electionType (default 'officer'), vacancyCount: int 1..20 optional
StartRoundSchema:        + eligibleCandidateIds: string[] optional
AddCandidateSchema:      { name }
UpdateCandidateSchema:   { id, name }
RemoveCandidateSchema:   { id }
```

### Vote logic (`packages/shared/src/voting.ts`) — already shipped

Pure, DB-free, fully unit-tested in `voting.test.ts`:

- `countVotes`, `buildTallies(voteCounts, nameById: ReadonlyMap<string,string>)`, `hasMajority`, `getMajorityThreshold`, `getTopCandidates` — moved from server `utils.ts`. Server re-exports for back-compat.
- `selectWinners(tallies, vacancyCount): WinnerSelection`:
  ```ts
  type WinnerSelection =
    | { outcome: 'decisive'; winners: VoteTally[] }
    | { outcome: 'tie'; decisiveWinners: VoteTally[]; tiedCandidates: VoteTally[]; seatsContested: number }
    | { outcome: 'no_votes' };
  ```
  Algorithm: drop abstentions and zero-counts; sort desc. ≤ `vacancyCount` candidates with votes → `decisive`. Strict gap at cutoff → `decisive` top N. Otherwise `tie` (decisiveWinners strictly above cutoff; tiedCandidates at cutoff, length ≥ 2). Throws on `vacancyCount < 1`.

`getRoundResult` reads `round.electionType` from the row (step 2). Officer arm = existing logic; by-election arm currently throws and lands in step 4 as `selection: selectWinners(tallies, vacancyCount)` + `vacancyCount`.

### Roster editability (the model)

Tellers are vetted; the physical room is messier than the database. CRUD allowed any time including mid-voting, with safeguards instead of locks:

- All mutations broadcast `roster_updated` over SSE.
- `remove` is always soft-delete; historical tallies and the log keep resolving names via the `removedAt`-not-null lookup path.
- During `voting` status, client shows banner + requires confirmation for `add`/`remove`. `update` is one tap.
- In-flight vote for a just-removed candidate → server rejects with "this candidate is no longer eligible"; client refreshes.

### `eligibleCandidateIds` storage

JSON-in-text on `rounds`, not a join table. Set is small (2–5 IDs), per-round, write-once, read every vote — colocating avoids a JOIN on the hot path. Soft-deleting candidates protects against stale IDs.

### Open risks (still live)

- **Soft-delete + tally rendering.** Verify each name-lookup site for historical results uses an "include removed" path.
- **Anonymous ballot vs. small candidate pools.** With small rosters and few voters, vote distributions can be identifying. No code fix; flag in teller copy if it matters.
- **Runoff that itself ties.** Same code path with a narrower `eligibleCandidateIds`. Worth a teller-copy note.
- **`bodySize` semantic drift.** Hidden in by-election creation but still on the row. Future cleanup; not v1.

### Out of scope for v1

Multi-vacancy ballots, mass roster import, write-ins, automatic-runoff (server creates the next round in `pending` instead of teller-clicks-CTA), name normalization/merge UI.
