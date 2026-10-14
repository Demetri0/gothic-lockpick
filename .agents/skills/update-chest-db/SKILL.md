---
name: update-chest-db
description: Use when updating the chest database (chests.json) in any way — syncing with external Gothic Remake lock catalogs (dsazz, unlockmyloot, religiosa1), adding locks we lack, refreshing the agreement score / doubt flags / game metadata, dropping or fixing wrong entries, translating names, or when a user reports a DB lock whose solution breaks the pick in game.
---

# Updating the chest database

`chests.json` is **generated, never hand-edited**:

```
chests.ini (raw, uncommitted)  +  tools/db-decisions.json (committed)  →  npm run build:db  →  chests.json
```

- **`chests.ini`** is never committed and may come from outside. Never edit it.
- **INI parsing is pipeline-only** (`tools/ini2json.cjs`). The app's own config parsers never read INI syntax.
- **Edits to either file are blocked** for Claude's file tools and shell redirection (`permissions.deny` in `.claude/settings.json`). Anything else, such as a script or another agent, is caught at commit time: the `pre-commit` check rebuilds `chests.json` and rejects a mismatch.

Every change goes into `tools/db-decisions.json`:

| Section | What it holds | Written by |
|---|---|---|
| `drops` | canonical keys of entries to exclude, so a re-imported ini can't reintroduce them | a human decision (see "Applying decisions") |
| `overrides` | canonical group → recorded entries (merges, fixes) | `npm run review:db`, or by hand for structural fixes |
| `additions` | entries with no ini counterpart | `sync-catalogs --add-missing`, by hand |
| `translations` | missing name/desc languages | `tools/translate-gaps.cjs` |
| `evidence` | agreement with external catalogs (derived, replaced whole) | `sync-catalogs --write-evidence` |

A canonical key is `pos|edges`, e.g. `5,2,1,0,6|1>4+;2>5+;3>5-` (`canonicalKey` in `tools/ini2json.cjs`). The build reports duplicate groups without a decision as `REVIEW-NEEDED`; it never merges them silently.

## Data model

- **Positions:** `pos` is 0-based (`0..6` for the app's 7 holes). `entryToPlates` adds 1 to the whole run. An entry out of range is rejected (`validatePlates`); it is never clamped or shifted to fit.
- **Name languages:** `LANGS` in `tools/translate-gaps.cjs`, currently ru, en, de, uk. The UI has three (`TRANSLATIONS` in `index.html`: ru, en, uk).

## How far the data can be trusted

Everything in the DB is third-party data of unknown accuracy, including the external catalogs. Every statement about it is hedged: say what was compared and how confident we are, never "verified", "correct" or "wrong". This applies to UI text, docs, release notes and replies to the user. For example, a source recorded by hand in game is "presumably recorded in game".

A transcription error (a missing link, a flipped sign, positions typed in reverse plate order) still describes a **solvable** lock, so the solver and the corpus sweep accept it. The player only finds out in game, when a plate hits the wall and the pick breaks. Comparing independent records of the same lock is the only way to flag such an entry beforehand.

## The full update cycle

```bash
npm run sync:catalogs                                  # 1. fetch + compare
#    read tools/catalogs/report.txt / lock-matrix.html
node tools/sync-catalogs.cjs --offline --add-missing   # 2. (optional) locks we lack → additions
npm run build:db
#    3. translate the new names (see "Translations")
node tools/sync-catalogs.cjs --offline --write-evidence  # 4. scores, doubt flags, game metadata
npm run build:db
npm run test:corpus && npx playwright test               # 5. every entry must still solve
```

Run `--write-evidence` **after** additions are built: it scores what `chests.json` contains. The two flags can't be combined in one run.

If a run aborts with `data fits orientation … declared …`, an upstream format changed. Inspect a few records of that source by hand, fix its `load()` or `orientation` in `tools/sync-catalogs.cjs`, and only then trust the output.

## Reading the report

The tool writes its output to the gitignored `tools/catalogs/`: `report.txt`, `matrix.json` and `lock-matrix.html`.

Each source declares its orientation relative to our DB:
- `R`: the source numbers plates in reverse order;
- `T`: its links are stored target→source;
- `X`: its positions are mirrored.

The run re-derives the orientation from the data and aborts on a mismatch.

A **variant** is one distinct (positions, links) record of the same physical lock. v1 is the variant backed by the most sources. `ours vA → vB: wall@N` means our solution for variant A, replayed on variant B, would break the pick on press N.

| Verdict | Meaning |
|---|---|
| `AGREE` | one variant, several sources |
| `KEEP-CONSENSUS` | we hold 2+ variants, external sources back exactly one |
| `DEDUP-BENIGN` | variants differ, but each solution also works on the other |
| `OURS-DISPUTED` | no external source backs any of our variants (incl. `⇄` reversed positions) |
| `SOURCES-DISAGREE` | ours is backed, but another source has different data. Often a record taken one move after the start |
| `MISSING` | an external lock we don't have |
| `ONLY-OURS` | no external data |

`sync-catalogs` never writes `drops`. Its "drop candidates" are input for a decision, not one.

## Agreement score, doubt and game metadata

`--write-evidence` stores per canonical key of our entries:

- `agree` / `disagree`: the sources holding the same / a different variant of this lock.
- `conf`: Σ weight(agree) − Σ weight(disagree).
- `doubt`: there is disagreement and `conf ≤ 0`.
- `better`: the key of our own variant of the same lock with a higher `conf`.
- `game`: the record of the source flagged `gameMeta`, i.e. the asset id (presumably the game's own, e.g. `OC_Chest_Guard242_Lock`), English name and place.

Weights, `gameMeta` and the doubt threshold live on `SOURCES` in `tools/sync-catalogs.cjs`. **They change only after discussion with the user.**

The build copies these onto entries as `conf`, `doubt`, `alt` (the better entry's id) and `game`. In the app (`db-search` block):

- **Ranking:** `conf` orders position-search results and breaks ties in name search (within a Fuse score band) and in chest hints. An entry without evidence counts as 0.
- **Warning glyph:** `doubt` puts it on search and hint cards.
- **Solve-stage notice:** `doubt` shows `#solve-doubt`, and `alt` adds the "open the other entry" button. The notice finds the entry structurally (`findIdenticalChest`), so it also fires for imports and `?lock=` links.
- **Search:** `game.id` and `game.name` are searchable.

dsazz is weighted highest because its asset ids look like extracted game data, but nothing proves that, so it is not ground truth. The notice says the entry *may contain an error* because *other sources describe this lock differently*. Keep new UI text in that register.

## Applying decisions

The DB is curated deliberately. Propose drops and fixes to the user; don't apply them on your own.

- **Drop:** never add a `drop` without asking the user first. Explain what the evidence is, why dropping is needed, and why it is right rather than the softer, reversible `doubt` flag. Drops suit entries contradicted by records presumably made in game. Once agreed, append the canonical key to `drops`. Existing `overrides` for that key can stay, because `drops` is checked first.
- **Additions:** `--add-missing` writes English names only (`"<place>, <name>"`). Area codes like `TST`, `SNT`, `OTT`, `Otown` and `SW` are unexplained in the source. Keep them as they are and don't invent a meaning.

## Merging duplicates and structural fixes

`npm run review:db` is a web UI that shows one queue item at a time. Use it for dedup merges and enrichment proposals. Positions and rules there are read-only.

A structural fix (a wrong link or position) is an `overrides` entry written by hand in `tools/db-decisions.json`, proposed to the user first. The full description is in `docs/db-pipeline.md`.

## Translations

```bash
node tools/translate-gaps.cjs --export     # tools/gaps/gaps-<lang>.txt
# translate each file (Google Translate or an equivalent machine translation)
#   → gaps-<lang>.translated.txt, same line count and order
node tools/translate-gaps.cjs --import ru  # likewise de, uk → staged (translationsPending)
```

Then run the AI verification pass over the staged texts:
1. Check them against `tools/gothic-glossary.json`, the Gothic canon (names, places, terms) and the UI terms (see `CLAUDE.md` → i18n).
2. Give the user a numbered list of suspicions with proposed fixes.
3. Patch staging after the user's verdicts.

Only then:

```bash
node tools/translate-gaps.cjs --finalize
npm run build:db
```

## Adding a catalog source

Add an object to `SOURCES` in `tools/sync-catalogs.cjs`. It needs:
- `id`, `title`, `url`;
- `orientation` and `weight`;
- optionally `gameMeta: true` (one source at most);
- `fetch(cacheDir)`;
- `load(cacheDir) → [{id, name, place, pos (0-based holes), M (M[moved][affected] ∈ {-1,0,1})}]`.

To find the orientation, run `calibrate(records, ours)` from the module. A real source matches a large share of our DB exactly under one orientation. A source with no exact match under any orientation is not real data: gothicremakelockpicking.com and nkbgaming were rejected for this reason (2026-10). Add such a source to the "Checked and rejected" comment instead. A new weight is a change to discuss with the user.

## Tests

- `tests/sync-catalogs.spec.js`: orientation, replay, verdicts, additions, evidence.
- `tests/db-pipeline.spec.js`: build pipeline incl. evidence → entry fields.
- `tests/check-chests.spec.js`: the pre-commit rebuild check.
- `tests/doubt.spec.js`: ranking, glyph and solve-stage notice in the UI.
- `tests/display-chain.spec.js`: real chests end to end against an independent solver.
