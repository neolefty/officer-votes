# E2E & CI Testing — Plan

A working plan for **browser e2e** (a multi-user election driven through the
real UI), **GitHub Actions CI**, and **social-auth e2e** (Google sign-in, see
`SOCIAL_AUTH_PLAN.md`) once it exists.

This is the **Tier 2 / CI / auth** companion to `TESTING_PLAN.md`, which already
owns **Tier 1** — the vitest server-integration matrix (router tests:
change/withdraw, anonymity invariants, close-race, P1–P5 phases). This doc does
**not** restate that matrix; see `TESTING_PLAN.md` for it and for the
`runMigrations(db)` / isolated-DB harness it specifies.

> Written to be picked up cold in a future session. Assumes code access but not
> the conversation that produced it. File/symbol references are current as of
> writing; verify line numbers before relying on them.

---

## What makes testing this app specific

Three properties drive every decision below:

1. **Inherently multi-participant.** A real test is one teller plus several
   voters acting concurrently. Isolation between "users" is the core fixture.
2. **Real-time via SSE.** The server pushes state changes over
   `GET /events/:code` (`packages/server/src/sse.ts`, `sseManager`). The most
   valuable — and flakiest — thing to assert is that one participant's action
   propagates to the others.
3. **Auth is just a bearer token in `localStorage`.** No cookies, no sessions.
   A "user" == a token + a name. `packages/client/src/trpc.ts` stores tokens in
   `localStorage['electionTokens']` keyed by uppercased election code, and
   sends `Authorization: Bearer <token>`; the server resolves the participant
   from that token in `createContext` (`packages/server/src/trpc.ts`). This is
   what makes multi-user browser testing easy here: **N users == N tokens == N
   isolated browser contexts.**

---

## Where the line is drawn (Tier 1 vs Tier 2)

- If an assertion is about a number, a tally, an invariant, or a rejection →
  **Tier 1** (vitest, see `TESTING_PLAN.md`). Fast, deterministic, no browser.
- If it's about "voter B's screen updates when the teller acts" → **Tier 2**
  (this doc). Keep the Tier 2 set small; it's the expensive, flakier tier.

Don't replicate the Tier 1 matrix in the browser. Tier 2 exists to prove the
wiring the unit/integration tests can't see: SSE → React render, the
localStorage token flow, and the real UI end to end.

---

## Tier 2 — browser e2e (Playwright)

### Setup

- Add `@playwright/test` as a **root devDep**; `npx playwright install
  chromium`.
- `playwright.config.ts` with a `webServer` running the **production
  single-process** server: Express serves the built client + `/trpc` +
  `/events` from one origin on port 3000 (`packages/server/src/index.ts`).
  Simpler and more representative than the dev Vite-proxy setup
  (`packages/client/vite.config.ts` proxies `/trpc` + `/events` from 5173 →
  3000, and `dev` does `sleep 2 && vite`). Suggested:
  - `command: 'pnpm build && DATABASE_URL=<tmp> pnpm start'`
    (`pnpm start` runs migrate then the server)
  - `url: 'http://localhost:3000'`, `reuseExistingServer: !process.env.CI`
- **Fresh DB:** point `DATABASE_URL` at a temp file for the run. Per-test
  isolation comes from **each test creating its own election** (unique code) —
  no global reset, naturally parallelizable.
- Root scripts: add `test:e2e` (= `playwright test`). Keep `pnpm test` (vitest)
  for Tier 1.

### The multi-user model: browser contexts

`browser.newContext()` gives each "user" an isolated `localStorage` — a perfect
match for the per-code token map. One test holds several:

```
teller = await browser.newContext()
voterA = await browser.newContext()
voterB = await browser.newContext()
```

Drive each, and assert cross-context SSE updates with **web-first assertions**
(`await expect(locator).toHaveText(...)`), which auto-retry and absorb most SSE
timing flakiness. **Do not use fixed `waitForTimeout` sleeps.**

### Seeding (hybrid — fast and robust)

Don't click through join forms to build state. Mint tokens with a real tRPC
client in the test, then inject them:

- Build a `@trpc/client` `createTRPCProxyClient<AppRouter>` with `httpBatchLink`
  at `${baseURL}/trpc` (**no transformer** — the server configures none, so
  payloads are plain JSON; `initTRPC...create()` in `trpc.ts`). Call
  `election.create` then `election.join` to get `{ code, token }`s. Reusing the
  real client avoids hand-crafting the tRPC batch wire format.
- Seed the token into each context before navigation:
  ```ts
  await ctx.addInitScript(([code, token]) => {
    localStorage.setItem('electionTokens', JSON.stringify({ [code]: token }));
  }, [code.toUpperCase(), token]);
  const page = await ctx.newPage();
  await page.goto(`/e/${code}`);
  ```
- Keep at least **one** test that creates/joins through the UI too, so that path
  is covered.

### UI selector surface (no `data-testid` exists today)

The client has **zero `data-testid` attributes**. Start with
`getByRole`/`getByText` against these (verbatim labels, current at writing):

- **Routes** (`App.tsx`): `/` (Home: create/join), `/e/:code` (Election).
- **Home → create:** button `Create New Election`; radios `Officer election` /
  `By-election (fill a vacancy)`; inputs `#election-name` (placeholder
  `e.g., LSA Officers 2024`), `#your-name-create`, `#body-size`; submit
  `Create`.
- **Join:** button `Join Election`; inputs `#join-code` (placeholder `ABC123`,
  maxLength 6, uppercased), `#your-name-join`; submit `Join`.
- **Vote (`VotingRound.tsx`):** heading `#vote-heading`; candidate buttons are
  `<button>`s with the candidate name and `aria-pressed` true/false; `Abstain`
  button (also `aria-pressed`); submit `Submit Vote` (or `Update Vote` when
  changing); `Cancel` in change mode.
- **Teller controls:** `Start New Round`; during a round `Cancel Round` /
  `End Round`; in the end modal `End Voting`, then a disclosure step with four
  options (`top` / `top_no_count` / `all` / `none` — labels vary by election
  type and majority, so match a regex like `/Show winner/`,
  `/Show all results/`, `/Don.t disclose/`) and submit `Share Results`.
- **Code + results:** header shows `Code: <CODE>`; results render in
  `RoundResults` when `state.result` is present.

**Selection hazards:** dynamic disclosure-button labels (regex / scope to the
modal); duplicated `Back` buttons (scope by form); modals are portals (`z-50`)
— wait for the modal before querying; candidate selection is
buttons-with-`aria-pressed`, not real radios; the Lobby invite link uses
`navigator.clipboard` — don't depend on it (seed tokens directly). If any flow
uses `window.confirm`, register a `page.on('dialog', d => d.accept())` handler.

**Optional DX win:** add a few `data-testid`s to the most dynamic/ambiguous
spots — candidate buttons, the voted-count display, the results region. Small
change, much less brittle. Not a blocker for a first pass.

### Tier 2 scenarios (keep the set small)

1. **Multi-user happy path (the anchor test):** teller creates + starts a
   round; voters A and B vote in their own contexts; the teller's screen shows
   the count rise via SSE; teller closes + reveals; voters' screens show
   results. One test exercises contexts + SSE + the token flow + the real UI.
2. **Live join:** a voter joins *after* a round starts and sees the active round
   without reload (SSE `participant_joined` / `round_started`).
3. (Once built) **change/withdraw:** a voter changes their vote; the teller's
   count stays/drops correctly in real time.

> SSE events to expect at the wire level (asserted indirectly via UI):
> `round_started`, `vote_status`, `all_voted`, `voting_closed`, `round_ended`,
> `round_cancelled`, `participant_joined`.

---

## GitHub Actions

None exists. Add `.github/workflows/test.yml`. Two jobs so unit/integration
feedback is fast and independent of browsers:

- **Common:** `pnpm/action-setup`, `actions/setup-node@v4` (node 20, pnpm
  cache), `pnpm install --frozen-lockfile`, `pnpm build` (builds the `shared`
  types server/client import, and the client bundle the prod server serves).
- **Job `unit`:** `pnpm test` (Tier 1 + the existing `voting.test.ts`).
- **Job `e2e`:** `npx playwright install --with-deps chromium`, then
  `pnpm test:e2e`. Upload the Playwright HTML report as an artifact on failure.

Gotchas:

- **`better-sqlite3` native build** — already in root `package.json`
  `pnpm.onlyBuiltDependencies`, so pnpm builds it; prebuilt Linux binaries
  usually exist. No Turso needed in CI (local SQLite via `DATABASE_URL`).
- Use a temp `DATABASE_URL` (under the runner temp dir) for the e2e webServer.
- `--with-deps` installs the OS libraries Chromium needs on the runner.

---

## Social auth in the e2e setup

Status: **not built yet** — see `SOCIAL_AUTH_PLAN.md` (Google OAuth as an
additive recovery/dedup layer; `users` table; nullable `participants.userId`;
Express routes `GET /auth/google` + `/auth/google/callback`; signed-state JWT;
**env-flagged so routes 404 and the button hides when unconfigured**).

### Key consequence: the base e2e is unaffected by social auth

Because OAuth is additive and env-flagged, **all Tier 1 / Tier 2 tests above run
with OAuth off (no `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) and are
completely unaffected.** The bearer-token path is unchanged. Only the
OAuth-specific tests are harder, and the hard part is narrow: the redirect
dance. Everything *after* the callback is your own recover/link/dedup logic.

### Decision: mock the provider at the HTTP boundary; real Google = manual smoke

- **Do not drive real Google in automated CI.** It blocks headless logins (bot
  detection, 2FA, captchas), needs real secrets + a test account, is
  slow/flaky/rate-limited, its consent UI drifts, and automating it is against
  Google's terms.
- **An OIDC emulator (Keycloak / `oidc-provider`) is overkill** for "Google as
  a recovery mechanism." Rejected.
- **Mock at the HTTP boundary** for all automated OAuth tests. **Real Google is
  a manual (or optional nightly, non-blocking) smoke test only.**

### Design prerequisite (cheap — bake in when Phase 5 is built)

Make the Google endpoint base URLs **configurable via env** (authorization URL,
token URL, userinfo / OIDC issuer), defaulting to real Google and overridable in
tests. If the implementation uses `arctic` (suggested in `SOCIAL_AUTH_PLAN.md`),
it accepts custom endpoints; if hand-rolled, read them from a small config
module. This one decision is what makes both local dev with fake Google and CI
testing possible — it costs nothing at build time and is the only thing the test
approach actually requires.

### The fake OAuth server

A tiny Express app (or the `oauth2-mock-server` npm package), pointed to by the
env override above, exposing:

- `/authorize` → immediately `302`s back to the app's
  `/auth/google/callback?code=<canned>&state=<echoed>`.
- `/token` → returns a canned `{ access_token, id_token }`.
- `/userinfo` → returns a **controllable** identity per test
  (`{ sub, email, email_verified, name }`).

Controllability of `sub` / `email` is what lets you test recover (same `sub` →
re-binds to the same `participants` row) and dedup (one participant per
`(electionId, userId)`).

### What each tier covers for auth

- **Tier 1 (vitest, in `TESTING_PLAN.md`'s harness):** the callback business
  logic — given a userinfo result, recover vs. link vs. create; the
  one-participant-per-`(electionId, userId)` dedup; state-JWT validation; the
  "anonymous-then-link" known gap from `SOCIAL_AUTH_PLAN.md`. Either drive
  `/auth/google/callback` against the in-process fake server, or unit-test the
  "resolve user → participant" function directly behind a flag-gated test seam,
  skipping the handshake entirely.
- **Tier 2 (Playwright):** the full redirect dance through the fake server —
  click `Continue with Google` → app → fake `/authorize` → back to callback →
  token minted → lands in the election. **Headline assertion:** the recover
  flow re-binds to the *same* participant from a fresh context with no existing
  token (the whole point of the feature).

### Manual real-Google smoke (runbook, not CI)

Keep this out of PR CI. When verifying for real:

1. Set real `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`; configure the
   authorized redirect URI `<origin>/auth/google/callback` in Google Cloud
   Console (per the planned `docs/google-oauth-setup.md`).
2. On a deployed/preview env, click `Continue with Google`, complete real
   consent, confirm the callback binds to the expected participant and the token
   lands.
3. Confirm the unconfigured path too: with the env vars unset, the routes 404
   and the button is hidden (boot log line + dev-only homepage footer per
   `SOCIAL_AUTH_PLAN.md`).

Optionally wire a **non-blocking nightly** GH Actions job gated on the secret
(`if: ${{ secrets.GOOGLE_CLIENT_ID != '' }}`) so it skips cleanly when absent.

---

## Prerequisites & code touch-points (this doc's scope)

1. **Playwright** — add `@playwright/test` + `playwright.config.ts`; add a
   `test:e2e` script; production-single-server `webServer` with a temp
   `DATABASE_URL`.
2. **CI** — add `.github/workflows/test.yml` (`unit` + `e2e` jobs).
3. **(Optional) `data-testid`s** on dynamic UI (candidate buttons, vote count,
   results) to de-flake Tier 2.
4. **(Social auth, future)** configurable Google OAuth endpoint base URLs — the
   single design prereq for mocking the provider.

> Tier 1's prerequisite (the `runMigrations(db)` refactor + isolated-DB harness)
> is owned by `TESTING_PLAN.md`. Tier 2 doesn't need it — it boots the real
> server against a temp file DB.

## Suggested sequence

1. Land Tier 1 first per `TESTING_PLAN.md` (cheap, no browser; also gives CI
   something to run immediately).
2. Add `.github/workflows/test.yml` running the `unit` job.
3. Playwright config + the multi-user happy-path anchor test; add the `e2e` CI
   job.
4. Add the live-join test.
5. (When social auth lands) configurable OAuth endpoints → fake-server fixture →
   Tier 1 callback-logic tests (in `TESTING_PLAN.md`'s harness) → one Tier 2
   recover-flow test. Real Google stays a manual smoke.

## Out of scope

- The Tier 1 server-integration matrix — see `TESTING_PLAN.md`.
- Load/perf testing of SSE fan-out.
- Visual regression / screenshot diffing.
- Driving real Google in PR CI (deliberate — see above).
