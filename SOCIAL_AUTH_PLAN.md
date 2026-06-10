# Social Auth — Plan

Add Google as a recovery mechanism layered on top of the existing
bearer-token participant model, so a participant can re-bind to the same
`participants` row from a new device or after a browser reset. Driven by
long-running elections (2 weeks) where session loss — especially for
tellers — is the highest-stakes failure mode.

## Scope decisions

- **In v1**: Google OAuth only. "Continue with Google" on the join
  screen and a "Link Google" action while signed in. Bearer token
  continues to work unchanged; OAuth is purely additive.
- **Deferred**: a "My elections" dashboard. Election links are
  distributed via chat/email anyway, so the real failure mode is
  device/browser change, not URL rediscovery. The schema below is
  shaped to support it later without migration.
- **Deferred**: required auth, and surfacing email to tellers. Both
  become a UI/permission flip later, not a schema change.
- **Deferred**: magic-link email and any non-Google provider.

## Schema

A tiny `users` table plus two columns elsewhere. All new columns are
nullable so existing rows and existing client code keep working.

```ts
// packages/server/src/db/schema.ts
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  oauthProvider: text('oauth_provider', { enum: ['google'] }).notNull(),
  oauthSubject: text('oauth_subject').notNull(),
  email: text('email').notNull(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
  displayName: text('display_name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  providerSubject: unique().on(t.oauthProvider, t.oauthSubject),
}));

// participants — additive
userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
```

Notes:

- `users.email` stored from day one but **not displayed** to tellers in
  v1. When tellers are allowed to see email later, no migration; just
  un-hide the column in the participant list.
- No DB-level uniqueness on `(electionId, userId)`. SQLite's NULL
  semantics in unique indexes are awkward, and `userId` is nullable.
  Enforce in the recover handler instead.
- Don't make `users.email` unique. `oauthSubject` is the identity;
  email can change, and email-uniqueness creates merge problems.

## Server

### OAuth routes

Two endpoints on Express (not tRPC, since they handle redirects):

- `GET /auth/google` — generates state, redirects to Google.
- `GET /auth/google/callback` — exchanges code, looks up or creates
  the `users` row, then either:
  - **Recover flow** (no current participant token): finds
    `participants` where `(electionId, userId)` matches; returns that
    participant's bearer token to the client.
  - **Link flow** (signed in as participant `P`): sets `P.userId` to
    the matched/created user. Idempotent if already linked.

Use a small library like `arctic` or hand-roll (~150 LOC). `passport`
is overkill. Callback URL is **generic** (`/auth/google/callback`, no
election code in the path) so Google's logs don't tie a user to an
election. State is a signed JWT carrying `{ intent, electionCode,
participantId? }`.

### `lastSeenAt` middleware

In `packages/server/src/trpc.ts`, inside the `authedProcedure`
middleware, after the participant is loaded:

```ts
db.update(schema.participants)
  .set({ lastSeenAt: new Date() })
  .where(eq(schema.participants.id, ctx.participant.id))
  .execute(); // fire-and-forget
```

Throttle to once per ~30s per participant via an in-memory
`Map<participantId, lastWriteMs>` in the server module. The map is
ephemeral; resets on deploy are harmless (worst case: one extra write
per participant after a deploy).

### SSE presence

Extend `sseManager` (`packages/server/src/sse.ts`) with a per-election
set of currently-connected `participantId`s, updated on connect /
disconnect. Expose `getActivePresence(electionId)` for the teller's
participant list. Broadcast a `presence` event on changes so the
teller's UI updates without polling.

In-memory only — no schema, no migration. On deploy the set rebuilds
as clients reconnect (SSE already reconnects automatically).

## Client

- **Join screen**: "Continue with Google" button beside the existing
  name-entry form. Recover flow if a matching `(electionCode, userId)`
  participant exists; otherwise fall through to the normal join.
- **Settings / profile area** (already in session): "Link Google
  account" button. Strong nudge for tellers — prompt once after
  election creation given the 2-week stakes.
- **Teller participant list**: show `createdAt` (already in schema as
  "Joined") and one of three states:
  - "Active now" if SSE-connected (from `getActivePresence`).
  - "Last seen Nm ago" from `lastSeenAt`.
  - "Joined only" if `lastSeenAt` is null (pre-migration rows).
- **No email rendered anywhere** in v1.

## Unconfigured OAuth (developer experience)

The whole feature hides itself when credentials are absent, so the app
runs with **zero OAuth setup** in local dev and in any deploy that hasn't
configured Google yet. One derived flag gates everything:

```ts
// packages/server/src/index.ts (or a small config module)
const oauthConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);
```

When `oauthConfigured` is false:

- **Routes**: `/auth/google` and `/auth/google/callback` aren't mounted
  (or 404). Nothing half-initializes.
- **Server startup log** — emit exactly one line at boot so the state is
  unambiguous in logs, alongside the existing `Server running on port…`
  in the `app.listen` callback (`index.ts:67`):
  - unconfigured → `console.warn`:
    `[auth] Google OAuth disabled — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable "Continue with Google". See docs/google-oauth-setup.md`
  - configured → `console.log`: `[auth] Google OAuth enabled`
- **Client button**: "Continue with Google" / "Link Google" are *hidden*
  (not disabled).
- **Dev-only homepage footer**: on the landing screen (`pages/Home.tsx`),
  when `oauthConfigured` is false **and** running in dev
  (`import.meta.env.DEV`, or `location.hostname` is `localhost`/`127.0.0.1`),
  render a small muted footer: *"Social login is off. To enable
  Continue with Google, set up Google OAuth credentials →"* linking to
  `docs/google-oauth-setup.md`. **Never shown in production** — an
  unconfigured prod deploy stays silent to end users; only the server log
  flags it there.

**Surfacing the flag to the client.** The button could piggyback on
`getElectionState`, but the homepage footer is *pre-auth* —
`getElectionState` needs election + participant context the landing
screen doesn't have. So add a tiny **unauthenticated** `config` query
(new `configRouter` in `routers/index.ts`) returning `{ oauthConfigured }`,
and have both the button and the footer read it. Only the boolean ever
leaves the server — never the client secret.

**Setup doc** (`docs/google-oauth-setup.md`, new — there's no `docs/`
dir yet): the step-by-step the warning and footer link to — create an
OAuth client in Google Cloud Console, set authorized redirect URI
`<origin>/auth/google/callback`, export the two env vars. One canonical
place to keep current.

## Migration & rollout

No election is live, so this lands in one go (server + client together)
rather than a phased, hot-safe deploy — consistent with the
`LONG_RUNNING_ELECTIONS_PLAN.md` decision. What still matters are the
*design* properties below, which hold regardless of deploy timing:

- **All schema additions are nullable / additive.** Old rows have
  `userId = null` and `lastSeenAt = null`; old code paths ignore both.
  `users` is a new table. Reset the dev DB if that's ever simpler.
- **Bearer tokens keep working as today.** OAuth is purely additive — a
  participant who never signs in is unaffected.
- **No changes to `votes`, `voteRecords`, `rounds`, or `candidates`.**
  At-rest vote anonymity is untouched; this work is independent of
  Phase 1's ephemeral `votes.participantId` linkage.
- **Client tolerates absent `lastSeenAt` / OAuth fields.** Render "Joined
  only" when `lastSeenAt` is null.
- **OAuth env config behind a flag.** If OAuth is unconfigured,
  `/auth/google*` routes 404 and the client hides the button — so the
  code can ship before OAuth is configured in production. See
  *Unconfigured OAuth (developer experience)* above for the startup log
  and dev-only footer that surface this to the developer.
- **In-memory state (throttle map, SSE presence) is ephemeral** and
  rebuilds on restart; neither affects voting correctness.

## Forward-compatibility hooks (intentional)

- `users` table exists from day one even though there's no "My
  elections" view. Adding that view later is a query, not a migration.
- `users.email` stored but hidden. Surfacing to tellers later is a UI
  flip.
- `participants.userId` nullable. Requiring auth later means flipping
  enforcement at the application layer, with existing rows
  grandfathered.

## Out of scope for v1

- "My elections" dashboard
- Required auth (any flow)
- Email surfaced to tellers
- Magic-link email recovery
- Non-Google providers
- Account merge UI (two Google accounts → one participant history)
- Email-change handling beyond storing the latest value on login
