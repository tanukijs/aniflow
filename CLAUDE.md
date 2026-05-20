# CLAUDE.md — aniflow

## Domain

The project serves a single use case: **spotting the gaps in an AniList
library**. The user has watched N anime; we want to know which franchises are
incomplete and in what order the missing entries should be watched.

Vocabulary:

- **Franchise** = a connected component of the AniList relation graph,
  restricted to the visible relations. Not a native AniList concept — it's our
  local grouping.
- **Franchise base** = the "root" node chosen to represent the franchise in
  the sidebar. Preference: format TV > Movie > OVA > Special, then "no
  incoming prequel/sequel", then alphabetical. TV is preferred because it's
  almost always the main chronological entry and the most recognizable one.
- **Seen / unseen** = present (or not) in the loaded AniList list. An "unseen"
  anime is never in the user's collection; it was pulled in by the BFS
  expansion to complete the franchise.

## Invariants to preserve

1. **Edge orientation: `source = older`, `target = newer`.**
   The whole layout (`dagre` with `rankdir: LR`) depends on this. The direction
   is derived from `startDate` when available, otherwise from AniList's
   PREQUEL/SEQUEL semantics. If you touch `collectGraph`, keep this invariant —
   otherwise arrows point every which way and franchises become unreadable.

2. **The `Visibility` filters are applied in TWO places.**
   - `acceptEdge` in `lib/expand.ts` — gates the network expansion.
   - `isVisibleEdge` / `isVisibleMedia` in `lib/graph/collect.ts` — gates the
     render.

   Adding a new criterion without touching both means either fetching things
   we won't display (wasted network) or displaying un-expanded nodes
   (truncated franchises). Strict matching: an anime with no `format` or no
   `status` is **rejected**.

3. **`computeFranchises` mutates `nodeData` when `hideCompleteFranchises` is
   true.** It deletes the ids of fully-watched franchises. Documented in the
   docblock, but easy to miss in a refactor.

4. **The `localStorage` cache is versioned via its key prefix**
   (`items_v2:${username}:${status}`). If the shape of
   `{ collection, extras }` changes, bump the prefix — otherwise existing
   users inherit a corrupt cache with no way to purge it.

## Non-obvious decisions

- **Expansion is bounded to 4 iterations** (`maxIterations` in `expand.ts`).
  In practice franchises converge in 2-3 hops; beyond that you hit extended
  universes (crossovers, anthologies) that pollute the graph without adding
  useful information.
- **Batches of 50 ids** in `pageQuery`: limit imposed by the AniList endpoint
  (`perPage: 50`). Not negotiable server-side.
- **PREQUEL is relabeled as SEQUEL for display.** Because we always flip the
  edge so that `source = older`, a PREQUEL becomes semantically a SEQUEL when
  viewed from the source. The label is rewritten in `collect.ts` to avoid
  showing "PREQUEL" on an arrow that points forward.
- **`fitView` runs inside a `requestAnimationFrame`**: xyflow applies node
  positions asynchronously after the React render. Without the rAF, the fit is
  computed against the previous state and the view ends up off-center.

## Out of scope

- **No auth, no AniList mutations.** The app is read-only and public; do not
  add an OAuth flow without explicit sign-off.
- **No tests** — the tsconfig excludes `__tests__` but none exist. Don't invent
  a test framework; ask whether tests are expected for a given feature.

## AniList API

- GraphQL endpoint: `https://graphql.anilist.co` (defined in `lib/anilist.ts`).
- Docs: https://docs.anilist.co/ — guide, rate limits, list of media statuses.
- Interactive schema explorer (GraphiQL): https://anilist.co/graphiql — use it
  to verify field names before editing a query, then `yarn generate` to refresh
  the generated types.
- No auth needed for public lists; rate-limited (currently ~30 req/min), which
  is why expansion is batched and bounded.

## Workflow

Before calling a task done, run `yarn type-check && yarn lint`. The lint runs
in `strict-type-checked` mode — it catches more silent regressions than `tsc`
alone.

`src/graphql.ts` is **generated** (`yarn generate`, from the live schema).
Never edit it by hand; it is excluded from ESLint and Prettier.
