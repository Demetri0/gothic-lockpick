# Chest database pipeline

How `chests.json` is built and maintained. This is the reference; the step-by-step procedures are in the `update-chest-db` skill (`.agents/skills/update-chest-db/SKILL.md`).

Everything in the database is third-party data of unknown accuracy, including the external catalogs it is compared with. Statements about it say what was compared and how confident we are, never that an entry is "verified" or "wrong".

## Layers

`chests.json` is what the app's search fetches (`fetch('chests.json')`). It is generated from three layers:

```
chests.ini                     raw input: a community-collected dataset (typos, mixed
   │                           languages; NOT in the repository, may come from outside)
   ▼ parse + normalize
tools/db-decisions.json        the decisions layer ("git rerere"): every human decision
   │                           is recorded once and replayed on every rebuild
   ▼ apply
tools/gaps/ → translations     machine-translation round trip
   │                           (fills only missing languages)
   ▼
chests.json                    the output, committed, loaded by the app
```

```bash
npm run build:db    # full rebuild: ini + decisions → chests.json
npm run review:db   # web review of duplicates and enrichments → http://localhost:3210
```

`chests.json` and `chests.ini` are never edited by hand:
- Claude Code denies edits to them (`.claude/settings.json`).
- The `pre-commit` check runs when `chests.json`, `tools/db-decisions.json` or `tools/ini2json.cjs` is staged. It rebuilds the entries from `chests.ini` with the staged builder and decisions, and rejects a committed `chests.json` whose `entries` differ, whoever edited it. Without a local `chests.ini` it warns and passes. It compares only `entries`, and it can't tell whether `chests.ini` itself was changed.

## Canonical key

A lock's identity is `pos.join(',') + '|' + the sorted set of edges`, e.g. `5,2,1,0,6|1>4+;2>5+;3>5-` (`canonicalKey` in `tools/ini2json.cjs`). It doesn't depend on rule order (`B:D-;C:B-` ≡ `C:B-;B:D-`); the old dedup compared rule strings and missed reordered duplicates. Every layer (`overrides`, `translations`, `evidence`, the review queue) is keyed by it, so decisions survive changes to the raw input.

## The decisions layer — `tools/db-decisions.json`

```json
{ "v": 1,
  "drops":        [ "<canonical key>" ],
  "overrides":    [ { "key": "…", "note": "review: dedup", "entries": [ {…} ] } ],
  "additions":    [ { …an entry with no ini counterpart… } ],
  "translations": { "<key>": { "byId": { "<id>": { "desc": { "de": "…" } } } } },
  "evidence":     { "<key>": { "conf": 3, "agree": ["dsazz"], "disagree": [], "doubt": true, "better": "<key>",
                               "game": { "id": "OC_Chest_…_Lock", "name": "…", "place": "…" } } } }
```

- **drops:** canonical keys excluded from the output (broken or unfixable ini data, or entries the user agreed to drop). A re-imported ini can't bring them back, and `chests.ini` itself is never edited. A drop is always the user's decision.
- **overrides:** a canonical group from the ini is replaced by the recorded `entries`. This holds the bootstrap freeze (see the history below), merged duplicates, enrichments and hand-written structural fixes.
- **additions:** entries with no ini counterpart, e.g. locks imported from external catalogs.
- **translations:** per-key translations, applied **only to missing languages**. A machine translation never overwrites an explicit name from the ini or an edited merge. `byId` addresses one entry inside an unmerged duplicate group.
- **evidence:** derived data from the external-catalog cross-check. It is rewritten whole by `sync-catalogs --write-evidence` and never edited by hand.

Duplicate groups **without** a decision are not merged silently: they appear as `REVIEW-NEEDED` in the build report and in the review queue. Entries without a usable name are kept, with `name: {}` and a stable id `lock-<positions>`; the UI shows a localized "Unknown lock" placeholder.

## Entry format

```json
{
  "id": "swamp-camp-cor-kalom-hut",
  "name": { "ru": "…", "en": "…", "de": "…", "uk": "…" },
  "desc": { "ru": "…", "en": "…", "de": "…", "uk": "…" },
  "rules": "A:B+,C-;B:A-",
  "pos": [4, 0, 6, 3, 2, 1],
  "tags": ["болотный лагерь", "кор галом"],
  "img": []
}
```

- **`pos`** is 0-based (`0..6`). The app adds 1 to the whole run (`entryToPlates`). An entry out of range is rejected (`validatePlates`), never clamped or shifted to fit.
- **Name languages** are `LANGS` in `tools/translate-gaps.cjs`, currently ru, en, de and uk. The UI has three locales (ru, en, uk).
- **`desc`** is optional (location and loot). It is stored but not shown in the UI.
- **`cells`** is stored too and equals `pos.length`.
- **Evidence fields:**
  - present only on entries an external catalog knows;
  - `conf`: agreement, the sum of the weights of agreeing sources minus those of disagreeing ones;
  - `doubt`: there is disagreement and `conf ≤ 0`, i.e. the disagreeing sources outweigh the agreeing ones;
  - `alt`: the id of a better-agreeing entry for the same lock;
  - `game`: the asset id (presumably the game's own), English name and place, from the dsazz catalog.

## Review tool (`npm run review:db`)

A dependency-free web page that shows one queue item at a time. All candidate entries appear side by side, next to an editable result: id, names/descriptions per language and tags. Positions and rules are read-only, so a structural fix (a link or position that needs correcting) is a hand-written `overrides` entry instead, proposed to the user first.

- **Buttons:** "Accept" writes the decision to `db-decisions.json` immediately; "Skip" moves on.
- **The queue** holds canonical duplicate groups plus external proposals from `tools/review-queue.json` (enrichments, conflicts, new locks).
- **An item disappears** only when its own type is resolved, so merging duplicates doesn't hide a pending enrichment of the same lock.
- **Proposed-merge heuristics:**
  - the id comes from the "best" candidate (name length + tags);
  - names and descriptions take the longest text per language;
  - tags are the union, without case duplicates.

## unlockmyloot sync (`node tools/sync-uml.cjs`)

[unlockmyloot.com](https://unlockmyloot.com) is an open (AGPL) solver with a curated lock catalog.

- **What the tool reads:** their ru/en pages (or `--cache`). It takes short names from the breadcrumbs and descriptions from the meta tags.
- **Decoding:** each config is decoded from its `?lock=` code, a base64url bit stream: 3 bits plate count − 3, 1 orientation bit, 3 bits per pin, 2 bits per link.
- **Classification** against our database:
  - **enrich:** the canonical key matches. It proposes filling our empty `desc` with their descriptions; our names win by default.
  - **conflict:** the rules match but the positions differ. The cause may be a typo on either side or a record taken after a move; the note holds both versions and a person decides. Both sides are usually solvable, so the solver can't arbitrate.
  - **add:** an unknown lock, ready as an `additions` entry.

Everything goes through the review queue; nothing is imported blindly. Only numeric codes and page texts are taken from their repository, no code.

## External catalog cross-check (`npm run sync:catalogs`)

`tools/sync-catalogs.cjs` fetches three catalogs into the gitignored `tools/catalogs/`:
- [dsazz/gothic-remake-lockbreaker](https://github.com/dsazz/gothic-remake-lockbreaker): its asset ids suggest extracted game data, but that is unproven;
- [unlockmyloot](https://github.com/1h8s/unlockmyloot);
- [religiosa1/gothic-lockpick-emulator](https://github.com/religiosa1/gothic-lockpick-emulator): presumably recorded by hand in game.

It then groups every record into physical locks and, for each disagreement, replays our solution on the other variant: `wall@N` means the pick would break on press N. The output is `report.txt`, `matrix.json` and `lock-matrix.html` (a lock × source matrix).

Each source declares its orientation (reversed plate order, links stored target→source, mirrored positions) and a weight. The run re-derives the orientation from the data and aborts on a mismatch, so a changed upstream format can't silently feed a mirrored matrix.

```bash
npm run sync:catalogs                                    # fetch and compare
node tools/sync-catalogs.cjs --offline --add-missing     # locks we lack → additions
node tools/sync-catalogs.cjs --offline --write-evidence  # agreement → evidence
```

A transcription error (a missing link, a flipped sign, positions in reverse plate order) can still give a solvable lock, and solvability alone can't show whether an entry matches the game. The cross-check is one source of evidence that can flag such an entry. The tool never writes `drops`. In the app, the evidence drives the ranking, the warning glyph and the solve-stage notice (see [user-guide.md](user-guide.md)).

## Translations (`node tools/translate-gaps.cjs`)

A machine-translation round trip with a mandatory AI review:

```bash
node tools/translate-gaps.cjs --export      # tools/gaps/gaps-<lang>.txt + .map.json
# → translate each txt (e.g. Google Translate) and save it line by line as
#   tools/gaps/gaps-<lang>.translated.txt (same order and line count!)
node tools/translate-gaps.cjs --import de   # → staging (translationsPending)
node tools/translate-gaps.cjs --import uk
# → AI review: check the staged texts against tools/gothic-glossary.json and the
#   Gothic canon (names, places, terms), list suspicions with fixes; after the
#   owner's verdicts, patch staging
node tools/translate-gaps.cjs --finalize    # staging → translations
npm run build:db
```

The export puts one text per line, with `.map.json` as a parallel key/id/field manifest, so a whole file can go into a translator at once.

The staging step exists so that a machine translation can't reach the database before the review. The canon catches what a machine translator doesn't know:
- `Ravens Turm` is a name, not "Rabenturm";
- `Cor Kalom`;
- `Sektierer`, not "Kultisten";
- `Feuerschutzring` is a ring *against* fire, not a fiery one;
- `Burg`, not "Schloss";
- Ukrainian «шкода» means damage, not losses.

`tools/translate.sh` (`npm run translate:db`) is a historical batch name translation through `claude --print`. It writes straight into `chests.json`, bypassing the decisions layer and the review step, so its output would be lost on the next build and is rejected by the `pre-commit` check. Don't use it; use `translate-gaps` instead.

## Migration history (July 2026)

1. **Bootstrap** (`tools/bootstrap-decisions.cjs`, one-off). `chests.json` had drifted from `chests.ini`: translations and manual edits lived only in the json, so a rebuild was destructive. The tool diffed a clean regeneration against the json by canonical key and froze all 393 differing groups as overrides with their current content. A rebuild was then checked to reproduce the database 1:1.
2. **Dedup review.** 83 canonical duplicate groups had survived the old string-based dedup; the owner merged 78 through the review tool. The database shrank from 508 to 394 entries, with names, tags and languages combined.
3. **Enrichment.** A sync with unlockmyloot found 38 locks: 36 exact matches (their set turned out to be a subset of ours) and 0 new. 34 enrichments were accepted, and 32 locks got ru/en descriptions (location + loot).
4. **Translations.** 30 descriptions went through machine translation into de/uk. The AI review caught 16 deviations from the canon before finalizing, leaving 32 locks with descriptions in all four languages.
