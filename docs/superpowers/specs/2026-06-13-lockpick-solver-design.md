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
  currentPos: Number,  // 1..positions
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
  activePlate: Number,      // id of selected plate
  history: String[],        // notation moves made in config stage
  solution: String[],       // current solve path (compressed notation)
  solverStep: Number,       // 0 = start, solution.length = end
  autoInterval: Number | null,
  cachedSolution: String[] | null  // reuse without re-running BFS
}
```

`cachedSolution` is set by both random generation and BFS solve. It is cleared on any config mutation (keyboard move, dep edit, plate count change, position count change, import). Re-entering config from solve without changes preserves the cache.

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
- `Позиции` — odd position count control `−/+` (minimum 3).
- Difficulty buttons 🟢 🟡 🔴 — trigger random generation.
- 📤 / 📥 — export/import via clipboard.
- `Ctrl+C` — copy current config (when no text selected).
- `Ctrl+V` — import config from clipboard (config stage only).
- Position strip — each plate with `◄ currentPos ►` controls.
- Dependency matrix — N×N table; diagonal disabled; LMB cycles `none→same→opposite`, RMB cycles reverse.
- `РЕШЕНИЕ` — start BFS or use `cachedSolution`.

Right panel: isometric 3D scene + keyboard legend.

### Solve Stage

Left panel:
- Solution notation string with current step highlighted; tokens are `white-space: nowrap`.
- Step list: `Начало`, numbered moves, `Конец`.
- Nav buttons: `Вернуться`, `← Шаг`, `▶ Авто` / `■ Стоп`, `Шаг →`.

Right panel: same 3D scene, cloned from solve-start positions.

`Ctrl+V` is blocked on the solve stage.

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

All handlers exit early when `e.target` is `INPUT/SELECT/TEXTAREA` or when the computing overlay is active.

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
| `A` / `←` | Step backward |
| `D` / `→` | Step forward |

---

## Isometric Rendering

CSS 3D turntable camera:

```css
.scene { transform: rotateX(-30deg) rotateY(-35deg); transform-style: preserve-3d; }
```

Plate geometry (per plate, index `i`, 0-based):
- `translateZ(-(PLATE_D + PLATE_GAP) * i)` — depth stacking.
- `translateX(posToOffsetX(currentPos, positions))` — horizontal slide.
- `.face.front` — vertical front face.
- `.face.top` — `rotateX(-90deg)` into X/Z plane.
- `.face.right` — `rotateY(90deg)` for depth side.
- Pins stand upright via `bottom: 100%` + mid-depth `translateZ`.
- Pin X is compensated by `pinLeft()` so pins appear fixed while plates slide.

Scene recenters via `--scene-cx` CSS variable; top padding via `--scene-overhead` for mobile.

---

## File Structure

```txt
index.html
  <style>                       CSS: theme vars, layout, scene, overlay, dialog, toasts, progress
  <body>                        Stage config, stage solve, overlay, dialog, toast container
  <script type="text/x-worker"> Worker: center, computeMove, compressPath, reconstructPath,
                                         bfsSolve (head-index + parent pointers), randomizer loop
  Script #1 — State             PLATE_W/D/GAP, DEFAULT_*, state object, makePlate(), center()
  Script #2 — Game logic        computeMove(), applyMove(), notation helpers (toNotation, parseNotation)
  Script #3 — Game helpers      posToOffsetX(), holeStep() and other render helpers
  Script #4 — Render            buildScene(), updateScene(), pinLeft(), syncMatrixPositions()
  Script #5 — Config UI         plate/pos controls, matrix, difficulty buttons, import/export,
                                 btn-start handler, clipboard copy/paste
  Script #6 — Solve UI          switchToSolve(), switchToConfig(), renderSolvePanel(),
                                 solveStepForward/Back(), jumpToStep(), auto-play
  Script #7 — WASD              keydown handler (config + solve stages)
  Script #8 — Init              init() wires all handlers, builds initial scene
  Script #9 — Worker bootstrap  createWorker(), onWorkerMessage(), workerError(),
                                 random pool management (createRandomPool, terminateRandomPool,
                                 onRandomPoolMessage, renderPoolProgress),
                                 solve-token (solveId), overlay/progress helpers
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
