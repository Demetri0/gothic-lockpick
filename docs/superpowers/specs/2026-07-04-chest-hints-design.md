# Live chest-match hints (config stage)

**Date:** 2026-07-04
**Status:** Approved design

## Summary

On the config stage, show a row of real Gothic-1-Remake chest cards between the
position lock (`#plates-positions`) and the dependency matrix (`#plates-matrix`).
Each card is a database entry whose disc positions match the user's current
positions by a **left prefix**. The row updates live as the user edits positions.
Clicking a card applies that chest's full configuration (positions **and**
dependency rules) — the payoff is recovering the hidden dependency rules of a
chest whose visible disc positions the user has just entered.

## Data facts (verified against `chests.json`, 508 entries)

- Entry shape: `{ id, name:{ru,en,de,uk}, cells, rules, pos:number[], tags:string[], img:[] }`.
- **No `description` field. No images** — `img` is empty for all 508 entries.
- `pos` is **0-based**, values `0..6` (7 holes). 351 entries contain a `0`.
- App `currentPos` is **1-based** (`1..positions`). Conversion is deterministic:
  `entry.pos[i] === currentPos[i] - 1`. No "try both 0/1-based" fallback — that
  dual check in `searchByPosition` exists only for free-text manual input where
  the user's convention is unknown; here both ends are known.
- Plate-count (`cells`) distribution: 4→22, 5→200, 6→265, 7→21. The app defaults
  to 4 plates, so plate-count mismatch against candidates is common and expected.

## Matching & ranking

Given `user0 = state.plates.map(p => p.currentPos - 1)`:

1. For each entry compute the **leading prefix match length** `L`: the count of
   consecutive indices from 0 where `entry.pos[i] === user0[i]`, stopping at the
   first mismatch or the end of the shorter array.
2. Compute a **combined match score** from two normalized signals:
   - `prefix = L / plateCount` — how much of the user's config the chest
     reproduces, left-aligned (`1.0` = every user disc matched).
   - `count  = 1 / (1 + |entry.pos.length − plateCount|)` — closeness of the disc
     count (`1.0` exact, decaying gently, never zero).
   - `score  = prefix * (0.7 + 0.3 * count)`.

   The combination is **multiplicative** so `prefix` is mandatory: an entry with
   the same disc count but no positional overlap (`prefix = 0`) scores `0`. An
   additive form would let the `count` term (0.3 at exact count) alone clear the
   gate and surface non-matching chests. Weights are `0.7 / 0.3` (prefix-dominant);
   `count` only modulates the multiplier over `0.7 … 1.0`.
3. **Candidates:** entries with `score > 0.25`. This effectively requires `L ≥ 2`
   (a single leading match tops out at `0.25` and is excluded).
4. **Rank** by `score` descending; tie-break by `pos.length` ascending, then `id`.
5. **Limit:** render the top **3**.

The score is returned alongside each entry (`{ entry, score }`) so the card can
map it to opacity. Pure loop over 508 entries per keystroke — negligible cost,
no Fuse.js.

## Card

Whole card is clickable. Contents (only what the DB actually has):

- **Name** via `entryName(entry)` (respects current UI language, with fallbacks).
- **Tags** joined by `, `.
- **Disc preview** — reuse the `sr-plate` / `sr-hole` markup shape from
  `buildResultCard` (7 holes per plate, active hole at `entry.pos[i]`), with
  hint-specific `data-test-id`s. The active hole of each plate in the leading
  matching prefix (`plateIdx < matchLen`, where `matchLen = L`) gets a `match`
  class and `data-match="true"` and is drawn **green** — visually marking exactly
  the discs that coincide with the user's positions. `computeChestHints` returns
  `matchLen` alongside `entry` and `score` for this.

The card name uses `entryName(entry)`, which already prefers `state.lang` (the
currently active UI language) and falls back through `ru → en → uk → de → first
available`. Because `setLanguage()` calls `renderMatrix()` — which re-renders the
hints — switching the interface language re-renders visible hint names in the new
language immediately. Tags are shown as stored in the DB (not language-specific).

Gradation: the card's opacity is driven by the match score. A full match
(`score ≈ 1`, i.e. same discs and same plate count) jumps to opacity `1.0`, while
partials map to a lower band `opacity = 0.35 + 0.45 * score` (~`0.46 … 0.80`).
This deliberately makes the gap between a full match and the best partial larger
than the gaps among partials. Because ranking and opacity share the same score,
the top card is always the brightest. The rounded score (`0 … 100`) is exposed as
`data-score` for testing. Every card stays fully clickable.

Click → `applyImportedConfig('start_pos="' + entry.pos.join(',') + '" rules="' +
entry.rules + '"')` (the same core `applySearchResult` uses, minus the dialog
close/stage switch since we are already on the config stage). Applying changes
the positions, which re-renders the hints — the clicked chest then matches fully.

## Layout & placement

- New container `#chest-hints` inserted **between** `#plates-positions` and
  `.matrix-wrap`.
- Horizontal flex row of up to 3 cards; each card is itself a row with the
  **name + tags on the left** and the **disc preview on the right**. Cards shrink
  as the window narrows.
- Responsive count (CSS `:nth-child` in the existing breakpoints, no JS): desktop
  3, tablet (`≤ 819px`) 2, mobile (`≤ 480px`) 1. `computeChestHints` still caps at
  3; the media queries only hide the surplus cards.
- Optional localized heading `hints-label` ("Похоже на:" / "Looks like:" /
  "Схоже на:"), shown only when there is at least one card.
- Empty candidate set → container hidden (`.hidden`), no "nothing found" text.
  This is a passive hint, not the search dialog.

## Re-render hooks

`renderChestHints()` is called from just two places, because every single-plate
position edit funnels through one setter:

- the end of `posSetPlateValue()` — the single entry point for a position change.
  Digit typing, the `+/−` buttons, arrow-key bump, PgUp/Dn, single-digit paste,
  and 3D-scene hole clicks all call `posSetPlateValue` rather than mutating
  `currentPos` directly (the `+/−` and hole handlers were refactored to do so).
- the end of `renderMatrix()` — covers structural changes (add/remove plate,
  `posStructuralUpdate` → `renderMatrix`), import (`applyPlates`/`applyImportedConfig`),
  randomize, reset, and language switch (`setLanguage`) — all call `renderMatrix`.

Gated on `chestDb` being loaded (renders nothing until then). A re-render is
triggered when `chestSearchReady` resolves, so hints appear once the DB finishes
loading even if the user set positions before load completed.

## Database-unavailable scenario (legitimate, must degrade silently)

`chests.json` may fail to load: offline first visit, fetch error, or the Fuse.js
CDN script missing (`loadChestDb` returns `null` in these cases; the hints
themselves don't need Fuse, but they share the same `loadChestDb`/`chestDb`
gate). This is a normal, expected state — **not** an error to surface.

Required behaviour:

- `renderChestHints()` must guard on `chestDb` and return early (container
  hidden) when it is `null`. No throw, no toast, no console error, no empty
  placeholder — the config stage looks exactly as it does today.
- Awaiting/observing `chestSearchReady` must not reject; a failed load resolves
  to "unavailable" and the hints stay hidden for the rest of the session (matching
  how the search button gets disabled). If a cached copy exists in `localStorage`,
  `loadChestDb` already recovers it, so hints work offline after a first success.
- No test may assume the DB is present without arranging it; the DB-unavailable
  path gets its own test asserting the hints container stays hidden and nothing
  else breaks (positions still editable, matrix still renders, SOLVE still works).

## Localization

Add `hints-label` to all three locales (`ru`, `en`, `uk`) in `TRANSLATIONS`.
No other user-visible strings are introduced (names/tags come from the DB).

## Testing (Playwright, English descriptions & comments)

New `data-test-id`s: `chest-hints`, `chest-hint-{i}`, `chest-hint-{i}-name`,
`chest-hint-{i}-tags`, `chest-hint-{i}-hole-{plate}-{hole}`, plus `data-score`
on the card.

Scenarios:

- `computeChestHints` excludes weak matches (`score ≤ 0.25`) and ranks by score.
- A differing plate count lowers the score at an equal prefix.
- A single leading match (`L = 1`) is excluded.
- Setting positions to a known entry's leading prefix shows that entry among the
  hints, ranked best first.
- Cards fade by score: a higher-scoring card carries a higher `data-score` and a
  larger computed opacity than a lower-scoring one.
- Clicking a hint card applies both its positions and its dependency rules
  (assert the resulting matrix/positions).
- Fewer than 2 matching leading discs → no hints (container hidden).
- With the DB fetch mocked to fail, the hints container stays hidden and the
  config stage still works (positions editable, matrix renders, SOLVE works).
- Switching the UI language re-renders a visible hint's name in the new language.

## Decisions locked

- Card limit: **4**.
- Section heading `hints-label` included.
- Matching is deterministic 0-based (no dual 0/1 fallback).
- Combined score `prefix * (0.7 + 0.3 * count)`, multiplicative, weights `0.7/0.3`.
- Inclusion gate `score > 0.25`; opacity `0.4 + 0.6 * score` (ranking, gate, and
  brightness all driven by the one score — no separate binary dim).
