# Architecture

How `index.html` is organized and which invariants keep it working. For config formats and position input see [formats.md](formats.md); for the chest database, [db-pipeline.md](db-pipeline.md).

## 1. Overview

The whole app is one HTML page, `index.html`, with no build step. The only runtime dependency is Fuse.js, loaded from a CDN for the chest search; npm packages are development tools (Playwright, `serve`). The page fetches `chests.json`, so it has to be served over HTTP (`npm start`); opened from disk, the database and search are unavailable.

## 2. Script blocks

The code lives in `<script>` blocks with semantic ids. To pull one out: `grep 'id="<name>"' index.html`.

| Block | Owns |
|---|---|
| `solver-src` | Solver core: `center()`, `computeMove()`, notation, `bfsSolveGrouped()`, `compressPath()`. Runs in the page **and** is injected into the worker Blob (§4). |
| `state` | Constants, `state`, `makePlate()`, `TRANSLATIONS`, `t()`, `setLanguage()` |
| `ui-utils` | `showToast()`, `copyToClipboard()` |
| `game-logic` | `applyMove()`, `getBlockingPlateId()`, `cycleActivePlate()`, `flashBlockedPlate()` |
| `render-scene` | `buildScene()`, `updateScene()`, `posToOffsetX()` (the 3D scene) |
| `render-preview` | `posStripHTML()`, `depMatrixHTML()` (+ `depCellColorHTML`/`depCellIconHTML`), `depDirIcon` — read-only visuals (§7) |
| `codecs` | `Codecs = {json, gothic, dotted, bytearray}`; facade globals `validatePlates()`, `PARSERS`, `parseConfig()`, `looksLikeImportConfig()` ([formats.md](formats.md)) |
| `url` | Shareable state (§6) |
| `config` | The position drum (`posSetPlateValue`), the dependency matrix (`renderMatrix`, `depCellHTML`), import/export, random generation, `entryToPlates()` |
| `solve-ui` | Step cards, navigation, auto-play, explore mode (`addExploreMove()`, `returnToSolution()`) |
| `keyboard` | The keyboard handler (config, solve, explore) |
| `init` | `init()`, incl. the call to `urlApplyOnLoad()` |
| `worker-src` (`text/x-worker`) | The worker entry: only `onmessage` (solve + random generation); the logic comes from `solver-src` |
| `worker-host` | `createWorker()`, the worker pool, progress, cancellation |
| `db-search` | `loadChestDb()`, Fuse search, position search, result cards, live chest hints (`computeChestHints()`, `renderChestHints()`), the solve-stage doubt notice, `loadEntry()` |

## 3. Styles

CSS is split the same way, into `<style>` blocks with semantic ids:

```
style-base        reset, body, .stage, .hidden
style-layout      panels, stages, 3D wrapper
style-preview     read-only visuals: mini dependency matrix, import preview card
style-controls    headings, buttons, inputs, the search pill
style-config      position drum + dependency matrix
style-notation    notation help dialog
style-search      search dialog, result cards, chest hints
style-solve       solution list, step cards, explore separator, solve-stage notices
style-overlay     block flash, computing overlay, import dialog, toasts, legend
style-tokens      palette (:root custom properties)
style-scene       3D scene: plates, faces, holes, pins, language selector
style-responsive  viewport media queries
```

The blocks apply in document order, exactly like one concatenated sheet. So **moving a rule between blocks changes the cascade**: add a rule to the block that owns its zone, and treat a cross-block move as a behavior change, not a refactor. Two consequences:

- `style-tokens` (the palette) sits late but works, because custom properties resolve at computed-value time.
- `.hidden` (in `style-base`) comes before component rules. A component that sets its own `display` needs an explicit `.component.hidden { display: none }` (see `.solution-list.hidden`) instead of relying on the utility.

There is no `!important` anywhere; keep it that way.

## 4. Solver and workers

**Solver logic lives only in `solver-src`.** That block runs as a normal page script, so its functions are page globals that tests can call. `createWorker()` also prepends its `textContent` to the worker Blob, so the tested code is exactly the code the worker runs. Never re-define solver functions in `worker-src` or anywhere else.

The solve and random generation run in Web Workers created from Blob URLs, so the UI never blocks:

- **Solve worker** (one): started by the Solve button. Returns the shortest path with the group optimization below.
- **Random-generation pool** (up to 8, by CPU count): workers try random configs in parallel. The first one to find a fitting config stops the others with `worker.terminate()`.

Progress is shown in an overlay: explored states for a solve; attempts and states per worker for random generation.

### `bfsSolveGrouped`

The only solver in the project, used by both the Solve button and the random generator. There are usually many solutions with the minimal number of presses, and a naive BFS returns the first one found, which often zigzags between plates. So the algorithm has three exact phases:

1. BFS from the start, recording `distS`, until the goal is found at depth `L`. BFS guarantees `L` is the minimum number of presses.
2. A backward BFS from the goal along the corridor of shortest paths (`distS + distG == L`). Moves are reversible, so the graph is undirected.
3. An exact DP over the corridor with node `(state, last plate)`, minimizing plate switches. The node doesn't need the direction: on a shortest path a plate can't move twice in a row in opposite directions, since that would return to the previous state.

The result is the minimal number of presses and, among those, the shortest step list (e.g. 41 presses: 30 groups from a naive BFS, 11 from this). For pathologically wide corridors (over 200k states) there is a greedy fallback, "prefer the same plate". It is still minimal in presses, but no longer guaranteed minimal in switches.

Progress is streamed through `onProgress` every 2000 explored states. The state space is at most `positions^N` (7 positions × 8 plates ≈ 5.7 million).

### Random-generation difficulty

| Button | Minimum plates | Solution length |
|---|---|---|
| Easy | 2 | 7–13 steps |
| Medium | 5 | 14–20 steps |
| Hard | 7 | ≥ 21 steps |

Length is counted in compressed notation (`1A3` = 1 step), i.e. exactly the step list the user sees.

### Solution cache

A solution found during random generation (`cachedSolution`) is reused when Solve is pressed without changing the config. A BFS solution is cached on first computation too. Any config change invalidates the cache: a key move, a dependency edit, or a plate-count change.

## 5. Single implementation points

Some logic exists in exactly one place, and every caller goes through it. Extend these; never copy their logic inline. A full review once found the same failure five times over: a teardown copied to several call sites, with each copy forgetting a different part.

| Function / value | Role |
|---|---|
| `posSetPlateValue(id, value)` | Changes one plate's position: clamps, syncs the input and buttons, updates the 3D scene, invalidates the cached solution, re-renders the chest hints. Config-stage `A`/`D` moves go through it too, moving a single plate with **dependencies ignored**: dependencies are a solve-stage rule, applied (and able to block) only in playback and explore. Never mutate `plate.currentPos` directly in a handler. |
| `applyPlates(plates)` | Replaces the whole config. Also invalidates any in-flight solve by bumping `solveId`. |
| `loadEntry(entry)` | Loads a DB entry from any stage. It leaves the solve stage before `applyEntry`; search results and the solve-stage "open the other entry" button both use it. |
| `stopAutoPlay()` | Stops auto-play: the interval **and** the button label. |
| `resetExploreState()` | Resets `solveMode`, `exploreHistory` and `detachStep`. |
| `isComputing()` | The "a solve is running" check. |
| `lastPlayedIndex` (in `renderSolvePanel`) | The one step cursor every step renderer reads. |

## 6. URL state

Shareable state lives only in the URL query string, never in `history.state`: `?lock=<dotted>` (the initial config; the solution is recomputed) plus an optional value-less `&solve`.

- **Pure helpers:** `urlQueryFor(plates, stage)` and `urlReadConfig()` take the config as input and don't touch the DOM.
- **Writing:** callers use `urlReplace` (config edits; every config mutation point calls it) or `urlPush` (entering and leaving the solve stage, so browser Back/Forward toggle the stage; `pushState` also clears the forward stack, so no stale entries remain).
  - Both are thin wrappers over the internal `urlWrite`, the only place that calls `history.replaceState`/`pushState`.
  - `urlWrite` is silent while `syncingFromUrl` is set, i.e. while the URL is being read back into the view.
  - On the solve stage the URL always holds the config snapshot `solveStartPositions`, never the mutated playback positions. Explore moves and playback steps are never written.
- **Reading:** there are two readers, both through `urlReadConfig`. **Neither calls the other.**
  - `urlApplyOnLoad` (defined in `url`, called from `init`) applies `?lock` silently, with no import dialog. It shows a toast on a present but unparseable `?lock`. It defers the `&solve` auto-solve to the `load` event, because the worker block runs after `init`.
  - `urlReconcile`, the single `popstate` listener, reconciles the view on Back/Forward.

## 7. Read-only previews

The `render-preview` block turns plates into HTML without reading the DOM or state:
- `posStripHTML` is the positions strip, reused by search cards;
- `depMatrixHTML(plates, renderCell)` takes a pluggable `depCellColorHTML`/`depCellIconHTML`;
- `depDirIcon` also lives here.

The `Ctrl+V` import dialog uses these to preview the pending config. When the database holds the same lock, the dialog shows a card for it, found by `findIdenticalChest`: a structural match on plate count, positions and edges, not the build-time canonical key.

## 8. Localization

- **UI locales** are the keys of `TRANSLATIONS`, currently ru, en and uk. The chest database has its own set of name languages (ru, en, de, uk; see [db-pipeline.md](db-pipeline.md)).
- **Every user-visible string** goes into all UI locales. Locale-independent symbols (`·`, `↩`) are the only exception.
- `t(key, vars)` returns the string for the current language.
- **`setLanguage(lang)`** re-applies three attributes across the page: `data-i18n` (text), `data-i18n-title` and `data-i18n-placeholder`.
- **The rule:** markup that stays on screen across a language switch carries these attributes, even when it is generated dynamically. A one-off `t()` is only for transient text (toasts) or for markup that is re-rendered on a language switch.
- **`tests/i18n.spec.js`** fails on:
  - a key missing from any locale;
  - a blank value;
  - a `data-i18n` attribute with no dictionary entry;
  - `t()` falling back to returning the key.
