# packages/shared

Source of truth for cross-package types, Zod schemas (`src/schemas.ts`), and the pure
vote-counting logic (`src/voting.ts`). Both server and client import from here, so treat this
package as a public API — a change to a schema or counting function ripples to both sides.

## Conventions

- Everything here stays pure and isomorphic: no Node APIs, no DOM, no IO, no env access.
- The `voting.ts` functions (`countVotes`, `buildTallies`, `hasMajority`, `getMajorityThreshold`,
  `getTopCandidates`, `selectWinners`) are deterministic and side-effect free. Keep them so.
- Zod schemas are the canonical shapes; don't fork these definitions in server or client.

## Review guidelines

- **P0:** off-by-one or boundary errors in majority / threshold / top-N selection that could
  declare a wrong winner. Majority is strictly greater than half (exact 50% is not a majority).
- **P1:** any change to `voting.ts` that doesn't add/extend `voting.test.ts`. Require coverage of
  zero votes, all-abstain, exact-50% vs >50%, ties, and `bodySize`-based vs votes-cast base.
- **P1:** schema field renames/removals that ignore server/client consumers or the hand-rolled
  migrations in `packages/server/src/db/migrate.ts`.
