---
name: update-chest-db
description: Use when updating the chest database (chests.json) in any way — syncing with external Gothic Remake lock catalogs (dsazz, unlockmyloot, religiosa1), adding locks we lack, refreshing the agreement score / doubt flags / game metadata, dropping or fixing wrong entries, translating names, or when a user reports a DB lock whose solution breaks the pick in game.
---

# Updating the chest database

`chests.json` is **generated, never hand-edited**:

```
chests.ini (raw, uncommitted)  +  tools/db-decisions.json (committed)  →  npm run build:db  →  chests.json
```

Every change goes into `tools/db-decisions.json`:

| Section | What it holds | Written by |
|---|---|---|
| `drops` | canonical keys of entries to exclude | a human decision |
| `overrides` | canonical group → recorded entries (merges, fixes) | `npm run review:db` |
| `additions` | entries with no ini counterpart | `sync-catalogs --add-missing`, by hand |
| `translations` | missing name/desc languages | `tools/translate-gaps.cjs` |
| `evidence` | agreement with external catalogs (derived, replaced whole) | `sync-catalogs --write-evidence` |

A canonical key is `pos|edges`, e.g. `5,2,1,0,6|1>4+;2>5+;3>5-`
(`canonicalKey` in `tools/ini2json.cjs`).

## Why external catalogs matter

A transcription error (a missing link, a flipped sign, positions typed in reverse
plate order) still describes a **solvable** lock, so the solver and the corpus sweep
accept it. The player only finds out in game, when a plate hits the wall and the pick
breaks. Comparing independent records of the same lock is the only way to catch that.

## The full update cycle

```bash
npm run sync:catalogs                                  # 1. fetch + compare (~3 min)
#    read tools/catalogs/report.txt / lock-matrix.html
node tools/sync-catalogs.cjs --offline --add-missing   # 2. (optional) locks we lack → additions
npm run build:db
#    3. translate the new names (see "Translations")
node tools/sync-catalogs.cjs --offline --write-evidence  # 4. scores, doubt flags, game metadata
npm run build:db
npm run test:corpus && npx playwright test               # 5. every entry must still solve
```

Run `--write-evidence` **after** additions are built. It scores what `chests.json`
contains, so a lock added after the last evidence run has no score.

If a run aborts with `data fits orientation … declared …`, an upstream format changed.
Inspect a few records of that source by hand, fix its `load()` or `orientation` in
`tools/sync-catalogs.cjs`, and only then trust the output.

## Reading the report

A **variant** is one distinct (positions, links) record of the same physical lock.
v1 is the variant backed by the most sources. `ours vA → vB: wall@N` means our
solution for variant A, replayed on variant B, breaks the pick on press N.

| Verdict | Meaning |
|---|---|
| `AGREE` | one variant, several sources |
| `KEEP-CONSENSUS` | we hold 2+ variants, external sources back exactly one |
| `DEDUP-BENIGN` | variants differ, but each solution also works on the other |
| `OURS-DISPUTED` | no external source backs any of our variants (incl. `⇄` reversed positions) |
| `SOURCES-DISAGREE` | ours is backed, but another source has different data. Often a record taken one move after the start |
| `MISSING` | an external lock we don't have |
| `ONLY-OURS` | no external data |

## Agreement score, doubt and game metadata

`--write-evidence` stores per canonical key of our entries:

- `agree` / `disagree`: the sources holding the same / a different variant of this lock.
- `conf` = Σ weight(agree) − Σ weight(disagree). Weights live on `SOURCES`: dsazz 3,
  unlockmyloot 2, religiosa1 2.
- `doubt`: there is disagreement and `conf ≤ 0`.
- `better`: the key of our own variant of the same lock with a higher `conf`.
- `game`: the record of the source flagged `gameMeta` (dsazz): asset id like
  `OC_Chest_Guard242_Lock`, English name, place.

The build copies these onto entries as `conf`, `doubt`, `alt` (the better entry's id)
and `game`. In the app (`db-search` block):

- **Ranking:** `conf` orders position-search results and breaks ties in name search
  (within a Fuse score band) and in chest hints. An entry without evidence counts as 0.
- **Warning glyph:** `doubt` puts it on search and hint cards.
- **Solve-stage notice:** `doubt` shows it, and `alt` adds the "open the other entry"
  button. `game.id` and `game.name` are searchable.

### Why the score is worded the way it is

dsazz looks like extracted game data (in-game asset ids), but nothing proves it. It is
weighted highest, but it is not ground truth. So the app never claims an entry is
"verified" or "wrong". The notice says the entry *may contain an error* because *other
sources describe this lock differently*. Keep any new UI text to that register: state
what was compared, not a verdict.

## Applying decisions

The DB is curated deliberately. Propose drops and fixes to the user; don't apply them
on your own.

- **Drop:** append the canonical key to `drops`. Existing `overrides` for that key can
  stay, because `drops` is checked first. Reserve drops for entries disproved by an
  in-game record (religiosa1-grade evidence). Otherwise the `doubt` flag is the
  softer, reversible option.
- **Additions:** `--add-missing` writes English names only (`"<place>, <name>"`). Area
  codes like `TST`, `SNT`, `OTT`, `Otown`, `SW` are unexplained in the source; keep
  them as they are and don't invent a meaning.

## Translations

```bash
node tools/translate-gaps.cjs --export     # tools/gaps/gaps-<lang>.txt
# translate each file → gaps-<lang>.translated.txt (same line count), using
# tools/gothic-glossary.json and the terms already in chests.json. The app's own
# terms: plate = "элемент" / uk "елемент" / en "plate"; links = "связи" / uk
# "зв'язки" / en "dependencies".
node tools/translate-gaps.cjs --import ru  # likewise de, uk
# verify the staged texts, then:
node tools/translate-gaps.cjs --finalize
npm run build:db
```

## Adding a catalog source

Add an object to `SOURCES` in `tools/sync-catalogs.cjs` with `id`, `title`, `url`,
`orientation`, `weight`, optionally `gameMeta: true` (one source at most),
`fetch(cacheDir)` and `load(cacheDir) → [{id, name, place,
pos (0-based holes), M (M[moved][affected] ∈ {-1,0,1})}]`. To find the orientation,
run `calibrate(records, ours)` from the module. A real source matches a large share of
our DB exactly under one orientation. A source with no exact match under any
orientation is not real data: gothicremakelockpicking.com and nkbgaming were rejected
for this reason (2026-10). Add it to the "Checked and rejected" comment instead.

## Tests

- `tests/sync-catalogs.spec.js`: orientation, replay, verdicts, additions, evidence.
- `tests/db-pipeline.spec.js`: build pipeline incl. evidence → entry fields.
- `tests/doubt.spec.js`: ranking, glyph and solve-stage notice in the UI.
- `tests/display-chain.spec.js`: real chests end to end against an independent solver.
