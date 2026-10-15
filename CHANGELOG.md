# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- The project is licensed under the MIT License (`LICENSE`). `NOTICE` lists the third-party
  sources of the chest database and their terms: records from dsazz/gothic-remake-lockbreaker
  (MIT) and lock descriptions from unlockmyloot (AGPL-3.0).

### Changed
- The GitHub Pages deploy runs on the Node 24 releases of its actions and on the Ubuntu
  26.04 LTS runner.

### Documentation
- Agent tooling and docs restructured. `CLAUDE.md`/`AGENTS.md` now hold only rules and
  pointers; reference docs live in `docs/` (`architecture.md`, `formats.md`,
  `db-pipeline.md`, `user-guide.md`); the README is rewritten in English. New tooling:
  - a `release` skill;
  - a pre-commit check that `chests.json` matches a fresh build;
  - a pre-push hook that tests the tip of each pushed ref in a temporary worktree, plus
    the corpus sweep when solver or DB code or data changed;
  - a lint for test selectors and URL writes.

## [1.6.0] - 2026-10-11

### Added
- **62 new locks** in the chest database, taken from the dsazz/gothic-remake-lockbreaker
  catalog: Bandit Camp, the mercenaries' and rogues' chests in the New Camp, the Old Camp
  armory, mages' rooms and guards' chests, and more. Names in all four languages. Every
  entry is solvable as recorded (the corpus sweep covers all 450 entries).
- `npm run sync:catalogs` (`tools/sync-catalogs.cjs`) cross-checks the database against the
  community lock catalogs and writes a lock-by-lock comparison matrix. Where records
  disagree, it replays our solution on the other version of the lock, which shows whether
  the entry would break the pick if the other version is the right one. Workflow in the
  `update-chest-db` skill.
- **Agreement with other sources.** Each chest entry is scored by how many of the other lock
  catalogs record it the same way. Search results and chest hints list the better-agreeing
  entry first. Entries that other sources dispute, outweighing the ones that agree, get a
  warning glyph and, on the solve stage, a notice to check the positions and links against
  the game; when the database holds a better-agreeing entry for the same lock, the notice
  offers to open it.
- Chests can be found by the asset id a catalog provides, presumably the game's own id (e.g.
  `OC_Chest_Guard242_Lock`).
- `npm start` serves the app at http://localhost:3000 (the chest search needs HTTP; opening
  `index.html` from disk can't load the database).
- An end-to-end test (`tests/display-chain.spec.js`) loads real chests through the search,
  solves them, and checks every step card and every 3D-scene position against an independent
  solver.

### Removed
- Three chest entries whose dependencies contradict records of the same locks that were
  presumably made in game. Replayed on those records, their solution would hit a wall on the
  2nd or 10th press: one of the two entries for Scatty's ring chest and two of the entries
  for the chest above the Arena. The entries for these chests that agree with other sources
  remain.

## [1.5.0] - 2026-07-26

### Added
- Opening the solve stage with every disc already centered now explains itself — "this lock
  is already solved, you may have forgotten to set the starting positions" — instead of
  showing an empty step list with dead navigation buttons.

### Changed
- Dependency-matrix cells switch from the direction word to the direction icon based on the
  **matrix's own width** (a container query at 670px) rather than the viewport, so an 8-plate
  matrix — where each cell is only `width / (N+1)` wide — now switches on desktop too instead
  of letting the text collide with the cell borders.
- The stylesheet is split into `<style>` blocks with semantic ids, mirroring the `<script>`
  blocks (`style-base`, `style-layout`, … `style-responsive`). Purely organisational: the
  blocks concatenate byte-identically in document order, verified against the previous
  single sheet by a computed-style diff over 139 elements. Still no `!important` anywhere.
- Internal cleanup from the review's non-defect findings: dropped two never-read pieces of
  state (the solver's per-layer corridor buckets and the explore-mode position snapshot —
  returning to a step always replays from the config), toasts can no longer leak a hidden
  node when their fade-out transition never fires, and cycling the active disc now handles
  an active id that is no longer in the config. No behaviour change.

### Fixed

A full review of `index.html` found 24 defects, each pinned by a test before it was
fixed (`tests/review-findings.spec.js`). The user-visible ones:

- **Applying a search result while a solution was open** left the app describing three
  different locks at once — state, the drum/matrix, and the URL all disagreed, position
  buttons went dead and SOLVE solved an invisible lock.
- **A randomly generated lock never reached the `?lock=` URL**, so sharing or reloading
  gave the previous lock and a browser Back silently destroyed the generated one.
- **Auto-play could not be stopped**: navigating to another step left the timer running,
  so playback resumed on its own while the Stop button was disabled. It also kept the
  «Стоп» label on an idle button after leaving the solve stage mid-play.
- **Undoing every free-explore move** (e.g. `A` then `D`) left the lock exactly at the
  detach point but with all three navigation buttons disabled.
- **A solve started before the config was swapped** could be accepted afterwards, showing
  a solution for the previous lock and sharing a URL it does not solve.
- **An unsolvable `?lock=…&solve` link** kept the flag in the URL, so every reload
  re-ran the whole search and re-showed the error.
- **Pasting digits into the drum** wiped the dependency matrix without a word; the digits
  now land in place while the plate count is unchanged, and when a clipboard config is
  deliberately not applied the app says so.
- **`Ctrl+V` with ordinary text** opened the import dialog and then called it invalid;
  it now ignores anything that is not a config (bare digits still belong to the drum).
- **Configs the app itself could not represent** (fractional or out-of-range positions,
  plates listed out of id order, oversized dependency steps) were accepted and then
  failed downstream — one reported a solvable lock as unsolvable, another crashed the
  scene builder. They are rejected at the gate now.
- **Out-of-range position digits** were silently clamped, inventing a config the user
  never typed; a run is now shifted as a whole or rejected.
- **The solution's one-line notation and the step cards highlighted different moves.**
- A broken chest database left the search reported as available while every `⌘K` failed
  silently; a random-generation worker crash left the overlay and buttons stuck forever;
  a queued solve waited behind an abandoned one.

## [1.4.0] - 2026-07-25

### Added
- Haptic feedback on mobile (Android): a short buzz on a blocked move and a light tick
  when a disc turns or a solution step plays manually. Silent no-op on iOS/desktop; needs
  no permission. Auto-play stays quiet.

### Changed
- Gothic rule parsing is now strict on content: a dependency must state a direction
  (`+`/`-`) — a direction-less or otherwise malformed token is invalid data and the config
  no longer imports (previously the token was silently dropped). Whitespace/case tolerance
  is unchanged.
- Removed 3 chests with malformed (direction-less) rules from the database (394 → 391); two
  were unsolvable as stored. A new `drops` decision keeps them out across `chests.ini`
  re-imports without editing the (externally sourced) ini.

### Fixed
- Config-stage `A`/`D` disc moves now edit only the active disc (ignoring dependencies,
  which are a solve-stage rule) and persist to the `?lock=` URL like every other config
  edit — previously they applied dependencies and were silently dropped from the shared
  URL (and could be wiped by a browser Back/Forward).
- A blocked first move on the solve stage no longer flips into explore mode; it stays in
  following mode until a move actually happens.

## [1.3.2] - 2026-07-24

### Added
- Opening a link with a present-but-unparseable `?lock` now shows a "link is broken"
  toast (an absent `?lock` stays silent). The config still validates the same way — the
  toast only explains why a shared link had no effect.

## [1.3.1] - 2026-07-19

### Changed
- Modal dialogs (import, search, notation) now close on a click outside their content
  (on the backdrop), matching the existing `Esc` behaviour.

## [1.3.0] - 2026-07-19

### Added
- **Shareable lock URL.** The lock config persists in a `?lock=<dotted>` query string
  (plus an optional `&solve`): opening a link applies it, editing updates it live via
  `replaceState`, and the browser Back/Forward buttons move between the config and the
  solution. Nothing is stored server-side; the solution is recomputed on load.
- **Import preview.** The `Ctrl+V` import dialog now previews the pending config as a
  labelled card — positions strip + dependency matrix — and, when the database holds an
  identical lock, shows that chest's card beneath it.
- **`⌘K` / `Ctrl+K`** opens the chest-search dialog (platform-aware hint on the button).
- **Pluggable config-format parsers.** Import auto-detects four formats — `json`,
  `gothic` (`040615 A:B-,C+;D:E-`), `dotted` (`3.531.saaoaa`), and `bytearray`
  (unlockmyloot `?lock=` v2 base64url; their share codes import directly). Each is a
  self-contained `{ parse, serialize }` unit behind a registry.
- **Solution steps as cards.** Each step renders as `Элемент N · [значок] Вправо ×4 · 4D4`
  (green = right / red = left) instead of bare notation, in both following and free-explore mode.
- **3D playback highlight.** The 3D scene highlights whichever plate the just-played step moved.
- **Direction icons in the dependency matrix** on narrow containers (arrows same-way / apart),
  replacing the single-letter abbreviation.

### Changed
- **Config-format codecs grouped under a `Codecs` namespace** (the `parsers` block is now
  `codecs`); rendering split into `render-scene` (3D) and `render-preview` (read-only
  config visuals), joined by a `url` block for the shareable-URL layer.
- Unified the ru/uk plate term to «Элемент»/«Елемент» (matches legend/tooltip wording);
  solve-stage step buttons use chevron icons instead of text arrows; brighter active-plate
  highlight in 3D.
- The app no longer parses `chests.ini` entries for import (INI is DB-pipeline only); the
  gothic format requires both positions and rules.
- `index.html` `<script>` blocks now carry semantic ids (`parsers`, `config`, `ui-utils`, …).

## [1.2.0] - 2026-07-06

### Added
- **Group-optimized solver.** The solver now guarantees not only the minimal
  keypress count (BFS) but, among all minimal solutions, the fewest switches
  between plates: bidirectional BFS builds the shortest-path corridor, then an
  exact DP over `(state, last plate)` minimizes groups (greedy fallback for
  corridors over 200k states). Verified against unlockmyloot.com's exact solver
  on shared reference locks (41 presses: 30 steps → 11; 23: 15 → 8; 56: 12; 30: 9).
  One solver everywhere — the randomizer uses it too, so a generated config
  caches exactly what solving it by hand would show.
- **Solver core extracted to a shared script** (`Script #0`, `id="solver-src"`):
  executes in the page (unit-testable globals) and is injected verbatim into the
  worker Blob — the tested code is byte-for-byte the code the worker runs
  (plus a runtime worker-equivalence test).
- **Reference lock suite**: four real locks (one in-game, three from
  unlockmyloot) pinned end-to-end — gothic-string parsing → dependency matrix →
  start positions → exact solver output, with the site's published solutions
  replayed through our engine as independent physics validation.
- **Chest DB curation pipeline** (`tools/`): reproducible builds via a committed
  decisions layer (`db-decisions.json` — overrides/additions/translations keyed
  by a canonical lock key, git-rerere style); `bootstrap-decisions.cjs` froze the
  previously diverged `chests.json` (393 groups) so `build:db` reproduces it 1:1;
  duplicate groups are never merged silently (`REVIEW-NEEDED`).
- **Merge review web tool** (`npm run review:db`): candidates side by side plus
  an editable merged record; decisions land in `db-decisions.json` immediately.
- **unlockmyloot sync** (`tools/sync-uml.cjs`): decodes their `?lock=` bitstream
  catalog and proposes enrichments/conflicts/additions through the review queue.
- **Translation round-trip** (`tools/translate-gaps.cjs`): per-language gap files
  for Google Translate, staged import, mandatory AI verification pass against
  the Gothic glossary/canon, then finalize (fill-only: machine translations
  never overwrite explicit names).
- **Mouse wheel** over a position digit acts as +1/−1, like its buttons.
- Localized "Unknown lock" placeholder for nameless DB entries (ru/en/uk).

### Changed
- **Database curated**: 78 duplicate groups merged (508 → 398 entries); 34 locks
  enriched with location/loot descriptions from unlockmyloot; 32 locks now carry
  `desc` in all four languages (de/uk via Google Translate + AI verification —
  16 canon/grammar fixes caught before finalizing).
- All single-plate position edits route through one `posSetPlateValue` entry
  point (typing, ±, arrows, wheel, 3D hole clicks).
- README difficulty table matches the actual generator bounds (7–13 / 14–20 /
  ≥21 grouped steps); difficulty is now measured on the same step list the user
  sees.

### Fixed
- 8-plate Gothic export round-trip: the parser accepted only `[A-G]`, silently
  dropping any dependency touching plate 8.
- Config-stage `A`/`D` keyboard moves refresh the chest hints.
- A dedup merge no longer hides a pending enrichment for the same lock in the
  review queue.
- Unavailable Clipboard API fails with a toast instead of an uncaught throw;
  returning from solve repaints the active-plate highlight.

## [1.1.0] - 2026-07-04

### Added
- **Live chest-match hints** on the config stage. As you enter disc positions, a
  row of real Gothic 1 Remake chest cards appears between the position lock and the
  dependency matrix, matched to the current positions by a left prefix. Clicking a
  card applies that chest's full configuration (positions **and** dependency rules).
- **Combined match score** driving inclusion, ranking, and card brightness:
  `score = prefix · (0.7 + 0.3 · count)`, multiplicative so a chest with no
  positional overlap never surfaces. Entries below `0.25` are dropped; a full match
  jumps to full opacity while partials share a lower band, so the gap above a full
  match is larger than the gaps among partials.
- **Green highlight** of the discs in a hint preview that coincide with the user's
  positions.
- **Dependency-aware ranking.** Once the matrix has entered dependencies, they
  modulate the score — matching edge `+0.5`, missing `−0.2`, opposite-direction
  conflict `−1.5` (clamped `≥ 0`). An empty matrix has no effect.
- **Colored rules line** on each hint card showing the chest's rules in gothic
  format (`A:B-,C+;D:E-`), with tokens green when they match an entered dependency
  and red when they conflict.
- **Full-name tooltip** (`title`) on hint cards, since the name/tags are
  ellipsis-truncated in the UI.
- **Mouse-wheel inc/dec** over a position digit — scrolling up/down nudges that
  plate's position by `±1`, like its `+/−` buttons.

### Changed
- Hint cards reflow to name + tags on the left, disc preview on the right, capped
  at 3 cards. The visible count follows the **container (panel) width** via CSS
  container queries — not the viewport — so a narrow config panel shows fewer cards
  even on a wide screen.
- All single-plate position edits (typing, `+/−`, arrow keys, wheel, 3D hole
  clicks) now route through one `posSetPlateValue` entry point, keeping the cached
  solution, input sync, 3D scene, and hint refresh in one place.

### Fixed
- Clicking a hole in the 3D preview now refreshes the hints (previously that path
  bypassed the hint update).
- Hints degrade silently when `chests.json` fails to load (offline / fetch error) —
  no errors, the container just stays hidden.

### Documentation
- Rewrote the stale position-input section of the README (combination lock + mouse
  wheel), added a "Подсказки-совпадения" section, and refreshed the architecture
  script list. Recorded the single-position-setter convention in `CLAUDE.md`.
