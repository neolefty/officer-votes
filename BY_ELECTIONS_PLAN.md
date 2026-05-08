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

### 3. `candidate.ts` router + roster mutations

New file `packages/server/src/routers/candidate.ts`, mounted in `routers/index.ts`. No status-based hard lock — mutations allowed regardless of round state.

- `list` (authedProcedure) → all rows including soft-deleted, sorted by `displayOrder`. Client filters to active for input UIs; uses full set to resolve historical names.
- `add` (tellerProcedure) → `{ name }`. Trim, reject empty. Reject if any **active** candidate already has the same case-insensitive name (soft-deleted rows don't count — re-adding a removed name is fine). `displayOrder = MAX + 1`.
- `update` (tellerProcedure) → `{ id, name }`. Trim, reject empty. Same case-insensitive uniqueness check, scoped to active candidates other than the row being updated (so re-casing your own name is fine). Allowed even when `removedAt` is set (typo fix on historical name).
- `remove` (tellerProcedure) → `{ id }`. Soft-delete (set `removedAt = Date.now()`). Hard-delete only if no votes reference the row.

Broadcast `roster_updated` SSE event after each mutation, to **both tellers and voters**. Payload is the **full roster snapshot** (all rows including soft-deleted) so clients replace state wholesale — no reducer logic, no drift if an event is missed.

Update `election.ts`: `create` persists `electionType` + `vacancyCount` (default `vacancyCount = 1` server-side when `electionType === 'by_election'` and the client didn't supply one). Refactor the shared `Election` type into a **discriminated union by `electionType`**:

```ts
type Election = ElectionBase & (
  | { electionType: 'officer';     vacancyCount: null }
  | { electionType: 'by_election'; vacancyCount: number; candidates: Candidate[] }
);
```

Officer arm has no `candidates` field — voter pool is `participants`. By-election arm guarantees both `vacancyCount: number` (no `| null`) and `candidates: Candidate[]`. `getElectionState` builds the correct arm from the row plus a candidates query (officer mode skips the query). The DB row stays flat — the union is the response shape only.

**Done when:** tellers can add/edit/remove candidates and voters' lists update live via SSE.

### 4. `round.ts` branching + UI

#### Server: `round.ts`

- `start`: inherit `electionType` from election. Accept optional `eligibleCandidateIds`; validate each ID is in this election's active roster. Default null for by-elections without it.
- `vote`: branch on `round.electionType`. Officer → validate `candidateId` is a participant. By-election → validate it's an active candidate, and if `eligibleCandidateIds` is non-null, validate membership. Abstain (`null`) accepted in both. Reject removed candidates with "this candidate is no longer eligible" so client can refresh.
- `closeVoting`: officer = existing. By-election = build tallies via candidates map, call `selectWinners`, drop majority enforcement.
- `end`: officer = existing `top_no_count` majority guard. By-election = all disclosure levels unconditionally available.

#### Client

- **`Home.tsx`**: radio for "Officer election" / "By-election (fill a vacancy)". When by-election: hide `bodySize`, hard-code `vacancyCount = 1`.
- **`Lobby.tsx` + new `CandidateRoster.tsx`**: mount under "Participants" tab when `electionType === 'by_election'`. Both tellers and voters use it; gate edit affordances on `isTeller`. Tellers see inline rename, soft-delete, "Add candidate" input. During `voting` status: show "Voting is open — changes will appear to voters live" banner; `add`/`remove` require a confirmation tap; `update` (typo fix) is one tap.
- **`StartRoundModal.tsx`**: take `electionType` prop. By-election → relabel "Office / Position" as "Round name." Default fresh round: `"Vote for vacancy"`. Default runoff (launched from tie CTA): `"Runoff: Alice vs. Bob"` (2 tied) / `"Runoff: Alice, Bob, Carol"` (3+). Always editable. When pre-filled from a tie, show read-only "Restricted to: Alice, Bob" line.
- **`VotingRound.tsx`**: by-election → render buttons from `state.candidates`, filtered to active and intersected with `round.eligibleCandidateIds` if set. "Abstain" stays in both modes.
- **`EndRoundModal.tsx`**: narrow on `result.electionType`. By-election → switch on `result.selection.outcome`:
  - `decisive` → "Elected: <names>"
  - `tie` → "Tied — runoff required" + "Start runoff round" CTA. CTA opens `StartRoundModal` with `eligibleCandidateIds = result.selection.tiedCandidates.map(t => t.candidateId)` and auto-generated name.
  - `no_votes` → "No votes cast"
  Drop the `top_no_count` "requires majority" gate and the "No majority reached" message in by-election mode.
- **`RoundResults.tsx`**: by-election copy off `result.selection.outcome`, no majority line. For runoff rounds, show "Runoff between Alice and Bob." above the tally.
- **`ElectionLog.tsx`**: in by-election rows, label "Top:" → "Elected:".
- **`Election.tsx` + `TellerControls.tsx`**: plumb `electionType`, `candidates`, `eligibleCandidateIds` down.

**Done when:** can run a full by-election end-to-end including a tied-runoff cycle, with live roster edits during an open vote.

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
