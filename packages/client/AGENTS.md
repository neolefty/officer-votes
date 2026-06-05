# packages/client

React + Vite + Tailwind SPA. tRPC client in `src/trpc.ts` (React Query), SSE in
`src/hooks/useSSE.ts`, pages in `src/pages/`, components in `src/components/`. The server is the
source of truth: the client renders `trpc.election.get` state and refetches on SSE events.

## Conventions

- Import entity types from `@officer-election/shared` (`ElectionState`, `Round`, `Candidate`,
  `RoundResult`, `DisclosureLevel`, …). Local interfaces are for UI-only props/shapes; don't
  re-declare domain entities.
- Branch election UI on `election.electionType` (`officer` | `by_election`): officer ballots draw
  from participants; by-elections use the candidate roster (`CandidateRoster.tsx`) and honor
  `round.eligibleCandidateIds` for runoffs (`VotingRound.tsx`).
- The auth token lives in `localStorage` under `electionTokens` (`{ code: token }`) and is sent as
  `Authorization: Bearer …`; a 401 clears it and drops to the join form.
- Real-time is a single `useSSE` handler that refetches election state — prefer a refetch over
  hand-maintaining derived state from event payloads.

## Review guidelines

- **P1:** redefining a shared domain type locally instead of importing it from
  `@officer-election/shared`.
- **P1:** UI that assumes officer semantics (participants-as-candidates, majority required)
  without the `by_election` branch, or vice versa.
- **P2:** treating the client as authoritative for anonymity/eligibility — those are enforced
  server-side; the client should simply not render data the server didn't send.
- **P2:** new real-time behavior that mutates local state from SSE payloads instead of refetching,
  risking divergence from server truth.
