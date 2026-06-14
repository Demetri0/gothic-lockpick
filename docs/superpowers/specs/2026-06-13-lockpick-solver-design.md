# Gothic Lockpick Solver — Design Spec

## Overview

Single-file browser app in `index.html`. No dependencies, no build step.

The app is an isometric visualizer and BFS solver for a disc-detainer-style lockpicking minigame. Users configure plates, positions, and dependency links, then run a shortest-path solver and step through the resulting solution.

Runtime stages:

- **Config** — edit the puzzle, move plates manually, randomize, import/export config.
- **Solve** — inspect the BFS solution and play it step by step or automatically.

Heavy BFS and random generation run in Blob URL Web Workers so the UI stays responsive. Random generation uses a pool of N workers (up to 8, based on `navigator.hardwareConcurrency`).

---

## Data Model

### Plate

```js
{
  id: Number,          // 1-based; 1 is nearest/front-most in the visual stack
  positions: Number,   // odd number ≥ 3; default 7; center = Math.floor(positions / 2) + 1
  currentPos: Number,  // 1..positions; 1 = leftmost hole, N = rightmost hole
  deps: [
    { targetId: Number, direction: 'same' | 'opposite', steps: Number }
  ]
}
```

All plates in a configuration share the same `positions` value. `steps` is always `1` in UI-generated configs; larger values are valid and supported by game logic.

### Runtime State

```js
{
  stage: 'config' | 'solve',
  plates: Plate[],
  activePlate: Number,          // id of selected plate
  history: String[],            // notation moves made in config stage
  solution: String[],           // current solve path (compressed notation)
  solverStep: Number,           // 0 = start, solution.length = end
  autoInterval: Number | null,
  cachedSolution: String[] | null,  // reuse without re-running BFS
  solveMode: 'following' | 'exploring',
  exploreHistory: Array<{ plateId, dir, steps }>,
  detachPositions: Number[] | null,  // plate positions at the moment of detach
  detachStep: Number | null,         // solverStep at the moment of detach
}
```

`cachedSolution` is set by both random generation and BFS solve. It is cleared on any config mutation (keyboard move, dep edit, plate count change, position count change, import). Re-entering config from solve without changes preserves the cache.

`solveMode` switches from `'following'` to `'exploring'` the first time the user presses A/D in solve stage. While exploring, `exploreHistory` accumulates free moves and `detachStep`/`detachPositions` record where the user branched off.

### Goal State

All plates satisfy:

```js
currentPos === center(positions)   // center(7) === 4
```

---

## Game Logic

### Movement

A move is `(plateId, direction)`, where direction is `'left'` or `'right'`.

1. Start with the moved plate and a delta of `-1` (left) or `+1` (right).
2. Collect **direct** dependencies of the moved plate only (non-recursive, non-transitive).
3. A `same` dependency receives the same sign × `dep.steps`; `opposite` receives the negative.
4. If any affected plate would leave `1..positions`, the whole move is blocked (returns `null`/`false`).
5. Otherwise all affected positions are updated simultaneously.

**Non-transitivity:** only the deps listed on the moved plate are affected. If plate A → B and B → C, moving A affects B but not C. C is only affected when B itself is moved directly by the player.

Raised pins are visual only; they do not affect movement.

### Blocking Plate Detection

When a move is blocked, `getBlockingPlateId(plates, plateId, dir)` finds the first plate whose boundary would be exceeded. `flashBlockedPlate(plateId, sceneId)` triggers a 250ms CSS shake animation (`plate-blocked` class) and red tint on that plate's faces via `filter`. The shake uses the `translate` CSS property (not `transform`) to avoid conflicting with 3D positioning.

### Notation

```
<plateId><direction><steps?>
```

- `A` = left, `D` = right
- `steps` is omitted when `1`

Examples: `1A`, `2D3`, `5A2`

Solution strings join moves with ` → `. Consecutive same-plate same-direction moves are compressed: `['1A','1A','1A']` → `['1A3']`.

---

## Solver

### BFS (in worker)

BFS state is an array of plate positions indexed by plate array order:

```js
[pos_plate1, pos_plate2, ..., pos_plateN]
```

Optimizations:
- **Head-index** — `let head = 0; while (head < queue.length)` replaces `queue.shift()`, O(1) dequeue.
- **Parent pointers** — nodes store `{ positions, parentIdx, move }` instead of copying the full path. Path is reconstructed once on goal hit via `reconstructPath`.
- **Streaming progress** — `onProgress` callback fires every 2000 iterations, sends delta to main thread for live counter updates.

Return value: `{ solution: String[] | null, iters: Number }`

### Solve Worker (single)

Handles `type: 'solve'` messages. One persistent instance, recreated after cancel.

Message protocol:

```js
// main → worker
{ type: 'solve', plates: Plate[], solveId: Number }

// worker → main (streaming, during BFS)
{ type: 'progress', itersDelta: Number }

// worker → main (final)
{ type: 'solve', solution: String[] | null, solveId: Number }
```

`solveId` is a counter incremented on each new solve request. The main thread rejects responses where `data.solveId !== solveId` (stale answer protection).

### Random Worker Pool

For random generation, a pool of `N = min(hardwareConcurrency || 2, 8)` workers runs in parallel. Each worker receives a fixed budget of `ceil(400 / N)` attempts. The first to find a matching config terminates all others via `worker.terminate()` from the main thread.

`randomPoolId` is a counter incremented on each new pool creation. Workers capture the id at creation time (`capturedId`) and compare against `randomPoolId` on message receipt to reject stale messages from old pools.

Message protocol:

```js
// main → each pool worker
{
  type: 'random',
  workerId: Number,        // 0-based index
  positions: Number,
  minSteps: Number,
  maxSteps: Number | Infinity,
  minPlates: Number,
  maxAttempts: Number
}

// worker → main (after each BFS attempt)
{ type: 'progress', workerId: Number, attemptsDelta: 1, itersDelta: Number }

// worker → main (on success)
{ type: 'random-found', workerId: Number, plates: Plate[], solution: String[] }

// worker → main (budget exhausted without match)
{ type: 'random-exhausted', workerId: Number }
```

Random generation algorithm per attempt:
1. Pick plate count from `PLATE_COUNTS` (filtered by `minPlates`).
2. Create plates with current `positions`, `0..2` random outgoing deps, random `currentPos`.
3. Skip if all plates already at center.
4. Run `bfsSolve`; accept if `solution.length` is in `[minSteps, maxSteps]`.

---

## Worker Source

Worker code lives in:

```html
<script type="text/x-worker" id="worker-src">
```

`createWorker()` reads this text and constructs a Blob URL Worker:

```js
function createWorker() {
  const url = URL.createObjectURL(new Blob(
    [document.getElementById('worker-src').textContent],
    { type: 'application/javascript' }
  ));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  return w;
}
```

Functions duplicated in worker: `center`, `toNotation`, `parseNotation`, `computeMove`, `compressPath`, `reconstructPath`, `bfsSolve`.

---

## Difficulty Buttons

| Button | Min plates | Solution length |
|---|---|---|
| 🟢 Easy | 2 | ≤ 7 |
| 🟡 Medium | 4 | 8–14 |
| 🔴 Hard | 6 | ≥ 15 |

Length is in compressed notation entries (e.g. `1A3` counts as 1).

---

## UI

### Config Stage

Left panel:
- `Элементы` — plate count control `−/+` (range: 2–8).
- `Позиции` — odd position count control `−/+` (minimum 3). Hidden via container query when panel is narrow.
- Difficulty buttons 🟢 🟡 🔴 — trigger random generation. Hidden via container query at narrower widths.
- 📤 / 📥 — export/import via clipboard.
- `Ctrl+C` — copy current config (when no text selected).
- `Ctrl+V` — import config from clipboard (config stage only).
- Position strip — each plate with `◄ currentPos ►` controls. **These buttons mutate `plate.currentPos` directly, bypassing `computeMove` entirely.** No dependency checks, no chain reactions, no blocking. This is intentional and must be preserved: the strip is a configuration tool that lets the designer place every plate at any valid position independently, regardless of what the dependency graph would allow during normal play.
- Dependency matrix — N×N table; diagonal cells are disabled and rendered with a stripe pattern to signal unavailability; LMB cycles `none→same→opposite`, RMB cycles reverse. Cells show `нет / прямо / обратно` at full width, abbreviated `Х / П / О` when the matrix container is narrow (container query on `#plates-matrix`).
- `РЕШЕНИЕ` — start BFS or use `cachedSolution`.

Right panel: isometric 3D scene + keyboard legend.

### Solve Stage

Left panel:
- Solution notation string with current step highlighted; tokens are `white-space: nowrap`.
- Step list: `Начало`, numbered moves (via CSS counter — no manual numbering in JS), `Конец`. Clicking any step jumps directly to it.
- Nav buttons: `Вернуться`, `← Шаг`, `▶ Авто` / `■ Стоп`, `Шаг →`.

Right panel: same 3D scene, cloned from solve-start positions.

`Ctrl+V` is blocked on the solve stage.

### Explore Mode

Pressing A/D in solve stage automatically enters explore mode (`solveMode = 'exploring'`):

- Auto-play stops if running.
- `detachStep` and `detachPositions` snapshot the current position in the solution.
- Subsequent A/D moves apply freely to the current plate state and append to `exploreHistory`.
- **Collapse logic:** consecutive moves on the same plate in the same direction increment `steps` on the last history entry; a move in the opposite direction decrements `steps` (or removes the entry if `steps` reaches 0). This prevents history bloat from back-and-forth.
- A separator `↩ вернуться к шагу N` appears between the BFS steps and explore steps. Clicking the separator returns to `detachStep`.
- Clicking any BFS step above the separator returns to that step in following mode.
- If a move is blocked, the blocking plate flashes (see Blocking Plate Detection).

`returnToSolution(targetStep)` resets `solveMode` to `'following'`, clears `exploreHistory` / `detachPositions` / `detachStep`, then calls `jumpToStep(targetStep)`.

### Computing Overlay

Shown during BFS and random generation. Contains:
- Spinner.
- Progress line (BFS: "Состояний проверено: N тыс." / random: "Попытки: N / M · K тыс.").
- Per-thread breakdown (random only) in tree-style monospace layout.
- Cancel button — terminates all active workers, resets state.

While overlay is active, keyboard events (WASD) are suppressed.

### Clipboard Import/Export

Export writes a JSON array of `{ id, positions, currentPos, deps }`.

Import validation:
- Array of 2–8 objects.
- All plates have the same odd `positions ≥ 3`.
- IDs form exactly the sequence `1..N`.
- `currentPos` in `1..positions`.
- Each `dep`: `targetId` ∈ `1..N`, not self; `direction` ∈ `{'same','opposite'}`; `steps` is a positive integer.

Escape on the import dialog clears the pending import state.

---

## Keyboard Controls

All handlers use `e.code` (not `e.key`) for locale-independent key detection. Handlers exit early when `e.target` is `INPUT/SELECT/TEXTAREA` or when the computing overlay is active.

### Config Stage

| Keys | Action |
|---|---|
| `W` / `↑` | Select next (deeper) plate |
| `S` / `↓` | Select previous (nearer) plate |
| `A` / `←` | Move active plate left; clears `cachedSolution` |
| `D` / `→` | Move active plate right; clears `cachedSolution` |

### Solve Stage

| Keys | Action |
|---|---|
| `W` / `↑` | Select next plate (visual highlight only) |
| `S` / `↓` | Select previous plate |
| `A` / `←` | **Following mode:** step backward. **Explore mode:** move active plate left |
| `D` / `→` | **Following mode:** step forward. **Explore mode:** move active plate right |

In following mode, the first A/D press switches to explore mode automatically — it does not step through the solution.

---

## Isometric Rendering

CSS 3D turntable camera:

```css
.scene { transform: rotateX(var(--tilt)) rotateY(var(--yaw)); transform-style: preserve-3d; }
```

Default values: `--tilt: -30deg`, `--yaw: -35deg`.

Plate geometry (per plate, index `i`, 0-based):
- `translateZ(-(PLATE_D + PLATE_GAP) * i)` — depth stacking.
- `translateX(posToOffsetX(currentPos, positions))` — horizontal slide. Position 1 = leftmost, position N = rightmost. `posToOffsetX = (center(positions) - currentPos) * holeStep(positions)`.
- `.face.front` — vertical front face.
- `.face.top` — `rotateX(-90deg)` into X/Z plane.
- `.face.right` — `rotateY(90deg)` for depth side.
- Pins stand upright via `bottom: 100%` + mid-depth `translateZ`.
- Pin X is compensated by `pinLeft()` so pins appear fixed while plates slide.

Scene recenters via `--scene-cx` CSS variable.

---

## Mobile Layout

At `@media (max-width: 819px)`:

- `body` and `#stage-config` switch to `height: auto; overflow: visible` (page scrolls).
- `.panel-right` moves to the top of the stage via `order: -1`, takes `height: 15vh`, `flex: 0 0 15vh` (in solve's column flex context).
- `.scene-wrap` is scaled down via `transform: scale(0.5); transform-origin: bottom center`.
- The keyboard legend is hidden.
- Each stage header (`h2`) shows two icon buttons (`.h2-actions`):
  - `↕` — expand 3D view to 50vh (`panel-3d-expanded` class); also increases scene scale to 0.75 with `transform-origin: center center`.
  - `⬡` — toggle 3D view visibility (`panel-3d-off` class). When off, the expand button is disabled.
- Solve stage only: `#stage-solve` is `height: 100vh; overflow: hidden; flex-direction: column`, so the step list scrolls internally while the header, 3D view, notation string, and nav buttons remain visible.
- Config stage: `#plates-matrix` remains scrollable as part of the natural page flow.

`.h2-actions` is `display: none` outside the mobile breakpoint — the buttons are invisible on desktop.

### Responsive Setting Row (Container Queries)

`.panel-left` has `container-type: inline-size`. Controls hide progressively as the panel narrows:

| Container width | Hidden element |
|---|---|
| ≤ 600px content-box | `Позиции` control |
| ≤ 420px content-box | Difficulty buttons |
| ≤ 270px content-box | Import/Export buttons |

Note: container queries measure the content-box. With `padding: 24px` on `.panel`, the effective border-box thresholds are ~648px / ~468px / ~318px.

### Responsive Dep Cell Text (Container Query)

`#plates-matrix` has `container-type: inline-size`. When the matrix is ≤ 360px wide, dep cell text switches from full (`нет / прямо / обратно`) to abbreviated (`Х / П / О`) via `.dep-full` / `.dep-short` toggling.

---

## File Structure

```txt
index.html
  <style>                       CSS: theme vars, layout, scene, overlay, dialog, toasts, progress,
                                     mobile media query (at end, after all base rules)
  <body>                        Stage config, stage solve, overlay, dialog, toast container
  <script type="text/x-worker"> Worker: center, computeMove, compressPath, reconstructPath,
                                         bfsSolve (head-index + parent pointers), randomizer loop
  Script #1 — State             PLATE_W/D/GAP, DEFAULT_*, state object, makePlate(), center()
  Script #2 — Game logic        computeMove(), applyMove(), notation helpers (toNotation, parseNotation)
  Script #3 — Game helpers      posToOffsetX(), holeStep(), depCellHTML(), getBlockingPlateId(),
                                 flashBlockedPlate(), addExploreMove(), returnToSolution()
  Script #4 — Render            buildScene(), updateScene(), pinLeft(), syncMatrixPositions()
  Script #5 — Config UI         plate/pos controls, matrix, difficulty buttons, import/export,
                                 btn-start handler, clipboard copy/paste
  Script #6 — Solve UI          switchToSolve(), switchToConfig(), renderSolvePanel(),
                                 solveStepForward/Back(), jumpToStep(), auto-play
  Script #7 — WASD              keydown handler (config + solve stages, explore mode)
  Script #8 — Init              init() wires all handlers, builds initial scene
  Script #9 — Worker bootstrap  createWorker(), onWorkerMessage(), workerError(),
                                 random pool management (createRandomPool, terminateRandomPool,
                                 onRandomPoolMessage, renderPoolProgress),
                                 solve-token (solveId), overlay/progress helpers

Shared helpers:
  wire3dButtons(expandId, toggleId, panelSelector)  — wires ↕/⬡ for both stages
```

---

## Constraints & Edge Cases

- Position count must be odd and ≥ 3. Increments by 2.
- Plate count: 2–8 (UI enforces upper limit).
- `currentPos` is clamped when position count decreases.
- Dependencies targeting removed plates are discarded on `rebuildConfig`.
- Self-dependencies blocked by import validation and matrix UI.
- Circular dependencies: harmless — `computeMove` is non-recursive and only reads `plate.deps` of the moved plate, so A→B→A cycles have no effect.
- BFS returns `null` if the state space is fully explored with no goal → error toast, stay in config.
- Empty solution `[]` (all plates already at center) → solve stage shows only `Начало` and `Конец`.
- `cachedSolution` from random generation is reused until any config change.
- BFS solve result also cached; returning from solve without changes reuses it.
- Cancel terminates all active workers, calls `resetProgress()`, recreates solve worker with all handlers.
- Stale BFS answers rejected via `solveId` token; stage check (`state.stage === 'config'`) as secondary guard.
- Stale random-pool answers rejected via `capturedId !== randomPoolId` check in `onRandomPoolMessage`.
- CSS `@media` and `@container` override rules must be placed **after** the base rules they override in the stylesheet, or they will be silently overridden by the later base rule (same specificity, later wins).

---

## Development

```bash
# Open directly in browser
open index.html       # macOS
xdg-open index.html   # Linux

# Run tests
npx playwright test

# One-time setup for pre-push hook
git config core.hooksPath .githooks
```

Pre-push hook (`.githooks/pre-push`) runs `npx playwright test` before every push. Playwright viewport is set to 1920×1080 so container queries on `.panel-left` (`45vw - 48px` content-box) don't hide controls under test.
