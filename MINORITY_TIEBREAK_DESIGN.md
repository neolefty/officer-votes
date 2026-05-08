# Minority Tie-Break — Design Exploration

Snapshot of an early design conversation, not a locked plan. Several open
questions remain — see the bottom section.

## The rule

Bahá'í elections recognize a special tie-break provision: when a vote is tied,
if exactly one of the tied parties is a member of a minority, that person is
declared the winner without a runoff. Applies to both election modes in this
app:

- **Officer elections** — tie at the top vote count when no majority winner exists.
- **By-elections** — tie at the cutoff seat (`selectWinners` `tie` outcome).

## Where ties already surface in the code

Both modes already detect ties cleanly; the resolution path is what's missing.

- **By-election**: `selectWinners` in `packages/shared/src/voting.ts:87` returns
  a `tie` outcome carrying `decisiveWinners`, `tiedCandidates`, and
  `seatsContested`.
- **Officer**: `getRoundResult` in `packages/server/src/utils.ts:200-223` builds
  tallies and computes `hasMajority`. When no majority is reached, `getTopCandidates`
  (`packages/shared/src/voting.ts:51`) yields the tied set.

Neither participants nor candidates carry any minority attribute today
(verified — no matches for `minority` / `isMinority` anywhere in the repo).

## Sketch of a minimal implementation

### 1. Data model

Add an `isMinority` boolean (default false) to:

- `candidates` table — by-election mode has an explicit candidate roster.
- `participants` table — officer mode has no fixed candidate list; any
  participant could end up tied, so the flag has to live on the participant.

Migration + schema update in `packages/server/src/db/schema.ts`, plus the
matching Zod/TS types in `packages/shared/src/{schemas,types}.ts`.

### 2. Resolution logic

In both `selectWinners` (by-election) and the officer branch of
`getRoundResult`, after a tie is detected:

- Filter the tied set to those flagged `isMinority`.
- If **exactly one** is flagged → promote them to winner.
- If **zero or 2+** are flagged → fall back to today's tie/runoff behavior.

Add a new outcome variant to the result shape, e.g.
`'minority_resolved'`, carrying both the resolved winner *and* the
originally tied set. This preserves auditability — the result still shows
the tie occurred and explains why a runoff wasn't needed.

For by-elections this slots into `WinnerSelection` as a fourth variant.
For officer mode, `RoundResult` would gain a parallel field (or its own
union shape, depending on how cleanly we want the two modes to mirror).

### 3. UI

- **Setup flows** — way to mark minority status when adding candidates
  (by-election) or participants (officer). Sensitive attribute, so consider
  copy/help-text carefully.
- **Teller end-of-round screen** — new branch explaining *why* the tie
  resolved without a runoff. Likely a confirmation step before reveal so
  the teller is in the loop (the rule applies in spirit, not silently).
- **Voter-side disclosure** — reveal copy needs to surface minority
  resolution as the reason a single name appears from a tied set.

## The real design call: who decides minority status, and when?

**Option A — Stored up-front on the roster.**
- Pros: clean, auditable, deterministic. The system applies the rule
  automatically when conditions match. No teller judgment in the moment.
- Cons: pushes a sensitive attribute into setup. In officer mode this
  means flagging *every* eligible participant, since any of them could be
  voted for. May feel uncomfortable to collect or display.

**Option B — Teller-declared at tie-break time.**
- Pros: flexible, may better match how a body actually applies the rule
  in practice (the body knows its own composition; no need to encode it).
- Cons: moves a sensitive judgment into the heat of the round. Less
  auditable — depends on the teller's knowledge in the moment.

**Lean (not decided):** Option A with a teller-confirmation step before
reveal — combines auditability with human-in-the-loop. But this has not
been validated against how Bahá'í communities actually handle it.

## Open questions

- How is "minority" defined for the purpose of this rule, in the
  community/contexts this app serves? (Definition affects whether a
  single boolean is sufficient or whether a category/string is more honest.)
- Should the rule apply to *every* tie, or only certain kinds (e.g. final
  seat, top-of-officer-ballot, but not earlier rounds)?
- If the tied set has 2+ minority members, current sketch falls back to a
  runoff. Is that right, or is there a further refinement (e.g. runoff
  among only the tied minorities)?
- Privacy: does the app ever need to *display* who is flagged as a
  minority, or is it strictly used internally to drive resolution and
  surface a reason at reveal time?
- Is there an audit/log requirement — should the round record specifically
  that it was resolved by minority tie-break, beyond just the result shape?
