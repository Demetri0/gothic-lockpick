# Import-confirmation preview + identical-lock lookup — design

## Goal

When a paste (`Ctrl+V`) parses to a valid config and the import-confirmation
dialog (`#import-dialog`) opens, show the user **what they're about to import**:
a compact read-only visualization of the pending config (initial positions +
dependency matrix). Additionally, search the chest DB for an **identical** lock
and, if found, show that chest's card beneath the preview.

Scope: the `Ctrl+V` import-confirmation dialog only. Not the search-result apply
(no dialog), not the URL-load path (silent), not the drum-paste policy.

## Block layout (introduce a `render-*` family)

The codebase already has a `worker-*` family (`worker-src` / `worker-host`).
Apply the same idea to rendering:

- `render` → **`render-scene`** (rename): the 3D isometric scene
  (`buildScene`, `updateScene`, `posToOffsetX`). Only the `<script id>` tag +
  docs change — no JS/test references the block id (verified: only `solver-src`
  and `worker-src` ids are read at runtime).
- **`render-preview`** (new): pure, DOM-free, read-only config visuals —
  `plates → HTML`. Depends on nothing; reused by search cards and the import
  dialog. Testable in isolation.

Dependency direction: `config` → {`render-preview`, `db-search`};
`render-preview` depends on nothing. No cycles.

## Components

### `render-preview` (new block) — pure `plates → HTML`

- `posStripHTML(positions0)` — the "row of 7 holes per plate, active one
  filled" strip. **Extracted** from the current inline markup in
  `buildResultCard` so cards and the import preview share one renderer.
  Input is 0-based active-hole indices (`entry.pos`, or
  `plates.map(p => p.currentPos - 1)`).
- `depMatrixHTML(plates, renderCell)` — builds the N×N read-only grid; delegates
  each cell to `renderCell(dir)` where `dir ∈ {'same','opposite','none'}` (and a
  neutral diagonal). Grid built once; the cell look is pluggable.
- `depCellColorHTML(dir)` — a coloured cell (same → green, opposite → red/pink,
  none → dim, diagonal → neutral), reusing the config matrix's existing colours.
- `depCellIconHTML(dir)` — an icon cell reusing the mobile same/opposite icons.

Size: comparable to `posStripHTML` — a mini display helper, not a full
visualization. Every emitted cell/hole carries a `data-test-id`.

### `db-search` (existing block) — minimal changes

- `buildResultCard` — replace the inline holes markup with
  `posStripHTML(entry.pos)`.
- `findIdenticalChest(plates) → entry | null` — exact match, sibling to the
  fuzzy `runChestSearch`. Lives here because it queries the loaded DB.

### `config` (existing block) — thin orchestration

- `renderImportPreview(plates)` — glue: renders the preview variants + the
  identical-lock card into `#import-preview`. Calls `render-preview` primitives,
  `findIdenticalChest`, and `buildResultCard`.
- `clearImportPreview()` — empties `#import-preview`.
- `openImportDialog(text)` parses `text` and calls `renderImportPreview`; the
  dialog `close` handler calls `clearImportPreview`.

## Identical-match algorithm (`findIdenticalChest`)

A DB entry is identical to the pasted `plates` iff **all** hold:

1. Same plate count: `entry.pos.length === plates.length`.
2. Same positions: `entry.pos[i] === plates[i].currentPos - 1` for every `i`
   (`entry.pos` is 0-based, `currentPos` is 1-based).
3. Same dependency edges, both directions: `entryEdges(entry)` equals
   `buildUserEdges(plates)` as `from>to → dir` maps (same key set, same dir per
   key). Both helpers already exist.

Match by structure, not by the build-time `canonicalKey` in `tools/`
(unavailable at runtime). Return the first identical entry (the DB is deduped,
so at most one canonical entry is expected); `null` if none.

## Data flow

```
Ctrl+V paste
  → looksLikeImportConfig(text) ? openImportDialog(text) : (ignored)
      openImportDialog: _importPending = text; parse = parseConfig(text);
                        renderImportPreview(parse); dialog.showModal()
  → user clicks Apply  → applyImportedConfig(_importPending); clearImportPreview()
  → user clicks Cancel → clearImportPreview()
  → dialog 'close'     → clearImportPreview() (belt-and-suspenders)
```

`parseConfig(text)` is guaranteed non-null here (the paste reached the dialog via
`looksLikeImportConfig`). Still, guard: if parse is null, render nothing.

## Two-phase A/B (icons vs colour)

The cell look is undecided; the grid is shared, so we compare live in the real
dialog rather than via screenshots.

- **Phase 1** — the dialog renders **both** variants stacked, each as a card of
  `[posStrip + depMatrix]`:
  ```
  [ Import ]
  [ Apply config from clipboard? ]
  ┌ Icons:  [posStrip] [depMatrixHTML(plates, depCellIconHTML)]  ┐
  ┌ Colour: [posStrip] [depMatrixHTML(plates, depCellColorHTML)] ┐
  [ Found in DB: <buildResultCard(identical)> ]   ← only if found
  [ Cancel ] [ Apply ]
  ```
  Temporary "Icons"/"Colour" labels distinguish them.
- **Phase 2** (after the user picks) — delete the losing `depCell*HTML` and the
  temporary labels; the dialog shows one card `[posStrip + depMatrix]` + the
  identical-lock card.

## HTML

Add `<div id="import-preview" data-test-id="import-preview">` between the `<p>`
and `.dialog-buttons` inside `#import-dialog`.

## i18n

New keys in all three locales (`ru`/`en`/`uk`):
- `import-found-in-db` — "Найдено в базе" / "Found in database" / "Знайдено в базі".
- Phase-1-only temporary labels `import-variant-icons` / `import-variant-color`
  (removed in phase 2).

Cell/hole visuals are locale-independent (colour/icon), no keys needed.

## Testing

- `tests/render-preview.spec.js` (pure, `page.evaluate`):
  - `posStripHTML` — N plates → N rows, correct active hole per row (data-test-id).
  - `depMatrixHTML` with each `renderCell` — N×N cells, correct dir per cell for
    a known config (same/opposite/none/diagonal), via data-test-id.
- `tests/import.spec.js` (integration, extend existing):
  - Paste a valid config → `#import-preview` is populated (both variant cards).
  - Paste a config identical to a known DB chest → the "found in DB" card shows
    that chest's name.
  - Paste a config with no DB match → no "found in DB" card.
  - Cancel/Apply → `#import-preview` cleared.

## Docs to update

- `CLAUDE.md`: semantic-id list `render` → `render-scene`, add `render-preview`;
  a convention bullet describing `render-preview` as the pure read-only config
  visuals reused by cards + the import dialog; note the identical-lock lookup is
  structural (not `canonicalKey`).
- `README.md`: architecture map — `render` → `render-scene`, add `render-preview`.

## Out of scope / YAGNI

- No adaptive icon/colour switching by plate count (may revisit after phase 2).
- No dep visualization added to the search cards themselves yet (the primitive
  becomes available for it, but wiring it there is a separate task).
- No change to the fuzzy "Looks like" hints.
