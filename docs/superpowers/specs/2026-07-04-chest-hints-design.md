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
2. **Candidates:** entries with `L > 1` (at least 2 leading discs match).
3. **Rank** candidates by:
   - `L` descending;
   - then exact plate-count first (`entry.cells === state.plates.length`);
   - then `cells` ascending, then name — for stable ordering.
4. **Limit:** render the top **4**.

Pure loop over 508 entries per keystroke — negligible cost, no Fuse.js.

## Card

Whole card is clickable. Contents (only what the DB actually has):

- **Name** via `entryName(entry)` (respects current UI language, with fallbacks).
- **Tags** joined by `, `.
- **Disc preview** — reuse the `sr-plate` / `sr-hole` markup shape from
  `buildResultCard` (7 holes per plate, active hole at `entry.pos[i]`), with
  hint-specific `data-test-id`s.

The card name uses `entryName(entry)`, which already prefers `state.lang` (the
currently active UI language) and falls back through `ru → en → uk → de → first
available`. Because `setLanguage()` calls `renderMatrix()` — which re-renders the
hints — switching the interface language re-renders visible hint names in the new
language immediately. Tags are shown as stored in the DB (not language-specific).

Dimming: when `entry.cells !== state.plates.length`, the card gets
`data-dim="true"` and reduced opacity. It stays clickable.

Click → `applyImportedConfig('start_pos="' + entry.pos.join(',') + '" rules="' +
entry.rules + '"')` (the same core `applySearchResult` uses, minus the dialog
close/stage switch since we are already on the config stage). Applying changes
the positions, which re-renders the hints — the clicked chest then matches fully.

## Layout & placement

- New container `#chest-hints` inserted **between** `#plates-positions` (line
  1065) and `.matrix-wrap` (line 1066).
- Horizontal flex row; cards shrink as the window narrows; ~3–4 fit on desktop.
- Optional localized heading `hints-label` ("Похоже на:" / "Looks like:" /
  "Схоже на:"), shown only when there is at least one card.
- Empty candidate set → container hidden (`.hidden`), no "nothing found" text.
  This is a passive hint, not the search dialog.

## Re-render hooks

`renderChestHints()` is called from:

- the end of `posSetPlateValue()` — covers digit typing, arrow-key bump, PgUp/Dn,
  and single-digit paste;
- the `+/−` button `click` handler on `#plates-positions` (~line 1832), which
  mutates `currentPos` directly and does **not** go through `posSetPlateValue`;
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
`chest-hint-{i}-tags`, `chest-hint-{i}-hole-{plate}-{hole}`, plus `data-dim` on
the card.

Scenarios:

- Setting positions to a known entry's leading prefix shows that entry among the
  hints, ranked by prefix length.
- A candidate whose plate count differs from the current plate count renders with
  `data-dim="true"`.
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
