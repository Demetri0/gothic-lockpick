# DB tools: rerere pipeline, dedup review, unlockmyloot sync, translation gaps

**Date:** 2026-07-06
**Status:** Approved design (decisions collected in-chat)

## Problem

- `chests.json` has diverged from `chests.ini`: translations (translate:db) and
  some manual dedup live only in the JSON, so `npm run build:db` is destructive
  — it would wipe accumulated work. The pipeline is not reproducible.
- `ini2json` dedup compares rules as raw strings, so reordered-rule duplicates
  survive (e.g. three identical cor-galom entries), and losers' tags/names are
  silently dropped.
- Entries without a usable name are skipped entirely; the user wants them kept
  with empty name/tags and a localized "unknown lock" placeholder in the app UI.
- unlockmyloot.com (AGPL repo, 40 curated lock pages ru+en) fully overlaps our
  DB by configs (37 exact, 2 position conflicts, 0 new), but has clean names
  and location/loot descriptions worth importing (owner accepts the gray zone).

## Verified facts

- Their `?lock=` v2 code: bitstream (3b plateCount−3, 1b display flip, 3b/pin,
  2b per ordered link pair) in a base64url alphabet. Decoder verified against
  live locks.
- Overlap probe: 37/40 exact canonical matches, 2 conflicts
  (`alberto-mine-upstairs-right`: ours 35360 vs theirs 06353;
  `cor-galom-bedroom`: ours 544603 vs theirs 554603), 1 page without a code
  (their own dup). Both sides of both conflicts are solvable — needs a human
  verdict.

## Design

### Canonical key

`key = pos.join(',') + '|' + sortedEdges.join(';')` where edges are directed
`from>to±` parsed from normalized rules. Stable under rule reordering; the
identity of a lock.

### Decisions layer — `tools/db-decisions.json` (committed; the "git rerere")

```json
{ "v": 1,
  "overrides":    [ { "key": "...", "note": "...", "entries": [ {…}, … ] } ],
  "additions":    [ { …full entry… } ],
  "translations": { "<key>": { "name": {"de": "…"}, "desc": {"uk": "…"} } } }
```

- `overrides`: the parsed-from-ini canonical group for `key` is replaced by
  `entries` (array — a group may legitimately stay as several entries until the
  user merges them). Recorded once, replayed on every rebuild.
- `additions`: entries with no ini counterpart (future uml imports).
- `translations`: per-key per-field per-lang texts, applied last.

Pipeline: `parse(ini) → transform → group by key → apply overrides → +additions
→ apply translations → chests.json`. Remaining multi-entry groups without an
override are emitted as-is and reported as `REVIEW-NEEDED` (no silent merging).

### Schema changes

- New optional `desc: {ru,en,de,uk}` on entries (stored + translated; not shown
  in the app UI yet — separate future task).
- Nameless entries are kept: `name: {}`, `tags: []`, id `lock-<posdigits>`
  (content-derived, stable). App UI (search results, hints) renders localized
  `unknown-lock` placeholder when `entryName()` comes up empty (ru/en/uk).

### Bootstrap migration (one-time)

`tools/bootstrap-decisions.cjs`: regenerate entries from ini cleanly, diff
against current `chests.json` by canonical key; any group whose content differs
(translations, done-dedups) is frozen as an override with the **current JSON
content**. After bootstrap, `build:db` reproduces today's chests.json (modulo
`updated` and newly rescued nameless entries), and no past decision is ever
re-asked.

### Translation gaps (BEFORE merge review)

`tools/translate-gaps.cjs`:
- `--export`: for each of ru/en/de/uk, write `gaps-<lang>.txt` (one source text
  per line — names and descs missing that lang) + `gaps-<lang>.map.json`
  (parallel array of `{key, field, srcLang}`). The txt goes through Google
  Translate by hand.
- `--import gaps-<lang>.translated.txt`: zip translated lines back via the map
  into `db-decisions.translations`.

### Review web tool

`npm run review:db` → `tools/review-server.cjs` (node, no deps) serves
`tools/review.html` + JSON API: GET pending items (canonical dup groups without
overrides; sync proposals), POST decision. UI: two candidate records side by
side + an editable merged third; accept writes an override into
db-decisions.json immediately. Follows app conventions (data-test-id) and gets
Playwright tests.

### unlockmyloot sync

`tools/sync-uml.cjs [--cache dir]`: fetch their repo lock pages (ru+en), parse
breadcrumb short names, meta/location/loot descriptions, decode v2 codes,
classify vs our DB: `NEW` → addition proposal, `EXACT` → enrichment proposal
(fill missing name/desc langs, replace junk names), `CONFLICT` → both position
variants + solvability. All proposals land in the review queue; nothing is
imported blindly.

## Decisions locked

- Languages: all four (ru/en/de/uk) in gap files.
- `desc` stored only; UI display deferred.
- Review tool: web page + tiny node server (not TUI).
- Dedup candidates: canonical-exact groups only (near-heuristics deferred).
- Work happens on the current branch; solver branch merge deferred.
- Their texts are imported knowingly despite the license gray zone (owner call);
  no code is copied from the AGPL repo.

## Phases

1. `ini2json` → exportable module; canonical key; keep nameless entries;
   apply db-decisions (overrides/additions/translations); reports. Tests.
2. Bootstrap tool; run it; verify rebuild reproduces current chests.json;
   commit decisions file.
3. App: unknown-lock placeholder (+3 locales, tests).
4. translate-gaps export/import (+tests); hand gap files to the owner.
5. Review server + page (+Playwright tests).
6. sync-uml (+tests on cached fixtures); enrichment/conflict proposals.
7. Live run: translations round-trip, review session, rebuild, commit DB.
