# Gothic Lockpick Solver — Implementation Status

## Goal

Maintain a single-file `index.html` app for configuring, visualizing, randomizing, and solving a disc-detainer-style lockpicking puzzle.

The app should remain:

- dependency-free;
- build-free;
- browser-runnable from `index.html`;
- split into readable CSS/HTML/script sections.

---

## Current Architecture

| Area | Current State |
|---|---|
| Packaging | One `index.html` file |
| UI | Two stages: Config and Solve |
| Rendering | CSS 3D isometric stack, no canvas |
| Logic | Vanilla JS functions in script sections |
| Solver | BFS, with compressed notation output |
| Heavy work | Blob URL Web Worker for solve/random |
| Import/export | Clipboard JSON plus paste fallback |
| Notifications | Toasts plus modal import confirmation |

---

## File Map

`index.html` contains:

| Section | Responsibility |
|---|---|
| `<style>` | Theme variables, responsive layout, config matrix, solve panel, overlay, dialog, toasts, CSS 3D scene |
| `<body>` | Toast container, import dialog, computing overlay, Config stage, Solve stage |
| Script #1 — State & constants | Dimensions, defaults, `state`, `center()`, `makePlate()` |
| Script #2 — Game logic | `computeMove()`, `applyMove()`, `isGoal()`, notation parse/format |
| Script #3 — BFS solver | Main-thread BFS helper and path compression |
| Script #4 — Render | `buildScene()`, `updateScene()`, hole/pin positioning |
| Script #5 — Config UI | Plate/position controls, dependency matrix, random buttons, clipboard import/export |
| Script #6 — Solve UI | Stage switching, solution rendering, step/jump/auto playback |
| Script #7 — WASD | Keyboard and arrow-key handling |
| Script #8 — Init | Initial state creation and first render |
| Worker source | Worker-safe copies of solver helpers plus random generation |
| Script #9 — Worker bootstrap | Worker creation, overlay progress, cancel, result handling |

---

## Implemented Features

- Configurable plate count.
- Configurable odd position count.
- Position strip with per-plate `◄/►` controls.
- `N x N` dependency matrix.
- Left click dependency cycle: `нет → прямо → обратно`.
- Right click dependency reverse cycle.
- WASD and arrow-key controls.
- CSS 3D plate stack with front/top/right faces, holes, pins, and active highlight.
- BFS shortest-path solver.
- Path compression, e.g. `1D`, `1D`, `1D` becomes `1D3`.
- Solve view with notation string, clickable steps, `Начало`, `Конец`.
- Forward/back buttons and keyboard stepping.
- Auto playback with stop toggle.
- Random generation with easy/medium/hard solution-length filters.
- Worker overlay with spinner, progress text, and cancel.
- Solution cache for generated configs.
- Clipboard export.
- Clipboard import with permission handling, paste fallback, validation, and confirmation dialog.
- Toast notifications for success/error feedback.
- Responsive layout that wraps panels on small screens.

---

## Current Randomizer

Difficulty buttons send:

| Difficulty | `minSteps` | `maxSteps` |
|---|---:|---:|
| Easy | `7` | `13` |
| Medium | `14` | `20` |
| Hard | `21` | `Infinity` |

Worker generation:

- tries up to `MAX_ATTEMPTS = 400`;
- picks plate count from `2..8`;
- assigns `0..2` outgoing dependencies per plate;
- assigns random positions;
- skips already solved configs;
- runs BFS;
- accepts only configs whose compressed solution length is inside the selected range.

The working tree currently includes an in-progress improvement where worker `bfsSolve()` returns `{ solution, iters }` and random generation accumulates `totalIter` across attempts. That makes the progress counter cumulative instead of resetting inside each candidate BFS.

---

## Important Behavioral Contracts

### Movement

- A move applies to the selected plate and recursively to dependency targets.
- `same` dependencies preserve movement sign.
- `opposite` dependencies invert movement sign.
- If any affected plate would move out of bounds, the whole move is rejected.
- All accepted effects are applied simultaneously.
- Raised/lowered pins are visual only.

### Solver

- BFS state is only the positions array.
- Dependencies are read from the plate config.
- `visited` uses `positions.join(',')`.
- Result must be shortest in uncompressed move count, then compressed for display.
- `null` means no solution.

### Stage Switching

- Entering solve stores a start snapshot.
- Solve actions mutate a cloned solve-stage plate array.
- Returning to config restores the start snapshot.
- Auto playback must be stopped when returning to config.

### Cache Invalidation

Clear `state.cachedSolution` when changing:

- plate count;
- positions count;
- any plate current position;
- any dependency matrix cell;
- imported config.

---

## Verification Checklist

Use this after meaningful changes:

- Open `index.html` in a browser and check the console for errors.
- Default config, all centered: click `РЕШЕНИЕ`; solve stage should show empty/zero-step solution and all pins raised.
- Move plate 1 away from center, solve, step forward with `D` or `Шаг →`; plate should return toward center.
- In Config, `W/S` changes active highlight and position strip active item.
- In Config, `A/D` moves the active plate and updates the position strip.
- In Solve, `A/D` steps backward/forward through solution.
- Auto playback reaches the end and stops.
- Dependency matrix:
  - left click cycles `нет`, `прямо`, `обратно`;
  - right click cycles reverse;
  - diagonal cells are inert.
- Random buttons show overlay and either produce a config or a toast failure.
- Cancel during random/solve hides overlay and later solve/random still works.
- Export copies JSON.
- Import button or `Ctrl+V` opens confirmation dialog and applies valid JSON.
- Invalid import shows an error toast and leaves current config unchanged.
- Narrow viewport wraps to a single-column layout without losing matrix or scene access.

---

## Known Maintenance Notes

- Worker code duplicates helper functions from the main scripts. Keep solver, notation, and move semantics in sync.
- `steps` in dependency objects is supported by game logic but the matrix UI only creates `steps: 1`.
- The main-thread BFS helper remains present, but user-triggered solve/random uses the worker path.
- Clipboard APIs vary by browser; keep the paste fallback.
- The app uses emoji export/import icons; if visual consistency matters, replace them with CSS/icon-font assets in a separate UI pass.
- The repository currently has documentation under `docs/superpowers/`; these docs are project docs, not runtime assets.

---

## Future Work Candidates

- Add difficulty constraints beyond solution length, such as minimum plate count and minimum dependency count.
- Format progress counters with `Intl.NumberFormat`.
- Consider displaying worker iteration progress in thousands if long runs become common.
- Reduce worker/main helper duplication by generating worker source from a shared text block or by documenting sync points more strictly.
- Add browser smoke tests with Playwright if the project grows beyond a single-file prototype.
