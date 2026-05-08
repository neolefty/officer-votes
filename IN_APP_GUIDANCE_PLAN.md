# In-App Guidance Reader — Design Notes

Plan for surfacing study material to participants who are mid-election (lobby, between rounds, etc.) without sending them out of the app.

## Goal

Make canonical guidance easy to dip into from any election page, especially on mobile, without risking a participant getting lost in their browser and losing the voting flow.

## Source material

Canonical text: **"The Sanctity and Nature of Bahá'í Elections"** (Research Department of the Universal House of Justice, December 1989).

- 6 thematic sections:
  1. Fostering a Spiritual Attitude towards Elections
  2. Qualifications of Those to be Elected
  3. The Non-Political Character of Elections
  4. The Absence of Nominations
  5. Participation in Elections
  6. The Role of the National Spiritual Assembly
- ~37 numbered passages, each a self-contained quotation with source citation.
- No prayers; entirely administrative/instructional.
- Available at https://www.bahai.org/library/authoritative-texts/compilations/sanctity-nature-bahai-elections/sanctity-nature-bahai-elections.xhtml

The discrete-passage structure is a gift for a swipeable-card mobile reader.

### Importing
The user has indicated openness to importing the text as canonical study material bundled with the app. This solves:
- Offline reading (basements with bad wifi are common election venues).
- No external navigation = no lost voters.
- Full control over typography, sizing, dark mode.

Likely format: parse the XHTML once into a JSON structure (`{ section, passageNumber, body, citation }[]`) that ships with the client bundle. Source attribution and a "View original on bahai.org" link should be preserved out of respect for the source.

## Chosen UX direction: bottom sheet + swipeable cards

Combination of two patterns:

### Shell — bottom sheet, expandable to full-screen
- Trigger: a small "Guidance" affordance present on every election page (lobby, voting round, results). Compact icon/label, doesn't dominate.
- At rest (peek state): sheet shows the 6 section titles + a "Continue reading" card if the user was mid-passage on this device.
- Drag up (or tap a section): expands to full-screen reader.
- Drag down or tap ✕: returns instantly to the exact voting state underneath. Voting page does not unmount.
- Backdrop dim while open; voting page faintly visible to maintain context.

### Inside — swipeable passage cards
- One numbered passage per card. Single thought per screen.
- Section name pinned at top of card.
- Passage number in bottom corner.
- Progress dots or "12 / 37" indicator.
- Swipe left/right to move between passages.
- Section picker accessible from the top header (tap the section name → menu of 6 sections, jump anywhere).
- Citation rendered below body in muted style.

### Why this combo
- Bottom sheet feels lightweight, not a detour; the peek state implies "tap to skim, swipe down to leave."
- Swipe cards match how people actually read on phones — one chunk per screen, thumb-friendly.
- Combined: low commitment to enter, low friction to leave, easy to resume.

## Where the trigger lives

Every page rendered inside `Election.tsx`:
- **Lobby**: most prominent — this is the natural waiting/study moment.
- **VotingRound (active vote)**: present but restrained. Should not visually compete with the ballot.
- **RoundResults**: present; useful between rounds.

A single component (`<GuidanceTrigger />` or similar) rendered in a consistent location (likely fixed footer area or a slim header pill) keeps it discoverable without re-implementing per page.

## Nice-to-haves (any version)

- **Resume position** — stored in `localStorage` per device, keyed by election or globally. Re-opening drops the user where they left off.
- **Search / jump-to-section** — for the "wasn't there something about not campaigning?" case.
- **Text-size control** — tellers and elders may need it; persist preference.
- **Offline-capable** — falls out naturally if the text is bundled.
- **Section landing view** — when entering the reader fresh (no resume position), show the 6 sections as a list with first-passage previews, then dive into card mode.
- **Dark mode** — already supported by the app, ensure reader inherits.
- **Respectful typography** — serif body, generous line-height, comfortable measure. The text deserves better than default sans-serif at default sizes.

## Patterns deliberately rejected

- **External link out** — the whole problem we're solving. Loses auth state on some flows, breaks the back-button mental model, and many participants won't find their way back mid-round.
- **Side drawer** — awkward thumb reach on mobile; better suited to navigation than content browsing.
- **Trapping modal dialog** — feels heavy and lacks the "swipe to dismiss" affordance phone users expect.
- **Listing all 4 home-page links on every page** — too much. The compilation is canonical study material; the other three (regional councils document, US LSA resources, the tallyj guidance page) are situational and stay on the home page.
- **Always-visible quote ticker** — visual noise during the actual ballot. A static "Guidance" affordance is calmer.

## Possible later additions (not in initial scope)

- **"Passage of the moment" strip** on lobby/results pages only (never during active voting), surfacing one rotating quote with "Read more" → opens reader. Adds ambient exposure for passive users.
- **Context-aware nudge between rounds** — "While you wait…" card surfacing a passage thematically suited to the moment (e.g. reflection-between-ballots passages when a round closes). High signal, low frequency.
- **Audio / read-aloud** — for eyes-tired users or those walking between sessions.
- **Sharing a passage** — copy-link-to-passage for use after the election.

## Open questions

- Bundle the full text as JSON in the client, or fetch from the server on first open and cache? Bundling is simpler; server-fetching makes future text updates cheaper. Bundle is probably correct given the document was last updated in 1989.
- Should the reader be available before joining an election (i.e. on Home), or only after? Probably both — but the home page already has the external link, so an in-app reader entry there is a separate decision.
- Internationalization: the source is English. If the app ever localizes, the compilation has official translations on bahai.org that would need to be sourced separately.
- Attribution: confirm acceptable form of attribution and any copyright/republication considerations before bundling. The Bahá'í Reference Library terms should be checked.

## Implementation sketch (when ready to build)

1. Parse the XHTML into `packages/shared/src/guidance.ts` (or a JSON file) — one-time scripted ingest with manual review.
2. Build `<GuidanceReader />` in `packages/client/src/components/` using a bottom-sheet primitive (Radix `Dialog` with custom slide animation, or `vaul`, or hand-rolled with framer-motion). Whatever's lightest.
3. Build `<GuidanceTrigger />` and place it in a shared location used by Lobby, VotingRound, RoundResults.
4. Persist resume position + text size in `localStorage`.
5. Verify on a real phone — mobile-only patterns deserve mobile-only testing.

## Status

Design direction agreed (2026-05-08). No code changes yet. Revisit when ready to schedule implementation.
