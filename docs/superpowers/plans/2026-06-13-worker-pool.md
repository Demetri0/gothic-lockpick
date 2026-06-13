# Worker Pool — Implementation Plan

**Goal:** Parallel random puzzle generation using a pool of Web Workers, preceded by BFS queue optimization.

**Architecture:**
- `worker` — single persistent worker for BFS solve, unchanged.
- `randomPool[]` — array of N workers, created per generation run, terminated on result/cancel.
- Pool size: `Math.min(navigator.hardwareConcurrency || 2, 8)`.
- Progress: total line + per-thread breakdown in overlay.

**Single file:** `index.html`. All changes are in-file sections:
- `<script type="text/x-worker" id="worker-src">` — worker code
- Script #5 (config handlers) — random button wiring
- Script #9 (bootstrap) — pool management, overlay rendering

---

## Task 1: BFS optimization — head index + parent pointers

**File:** `index.html`, worker-src section (`bfsSolve`, currently ~line 1532).

Replace `queue.shift()` (O(n)) with head index (O(1)).
Replace path copying (`[...path, move]`) with parent pointer reconstruction.
Remove the periodic `% 1000` progress message from inside `bfsSolve` — random mode will send deltas from the outer loop, solve mode sends a single final count after BFS returns.

- [ ] Add `reconstructPath` before `bfsSolve` in worker-src:

```js
function reconstructPath(queue, idx) {
  const path = [];
  while (queue[idx].move !== null) {
    path.push(queue[idx].move);
    idx = queue[idx].parentIdx;
  }
  return path.reverse();
}
```

- [ ] Rewrite `bfsSolve` — no periodic postMessage, no iterOffset parameter:

```js
function bfsSolve(plates) {
  const startPos = plates.map(p => p.currentPos);
  const goalPos  = plates.map(p => center(p.positions));

  if (startPos.every((p, i) => p === goalPos[i])) return { solution: [], iters: 0 };

  const startKey = startPos.join(',');
  const visited  = new Set([startKey]);
  const queue    = [{ positions: startPos, parentIdx: -1, move: null }];
  let head = 0;
  let iter = 0;

  while (head < queue.length) {
    const { positions } = queue[head];
    const currentIdx = head;
    head++;

    const snap = plates.map((p, i) => ({ ...p, currentPos: positions[i] }));

    for (const plate of snap) {
      for (const dir of ['left', 'right']) {
        const effects = computeMove(snap, plate.id, dir);
        if (!effects) continue;

        const newPos = [...positions];
        for (const { plateId, newPos: np } of effects) newPos[plateId - 1] = np;

        const key = newPos.join(',');
        if (visited.has(key)) continue;
        visited.add(key);
        iter++;

        const newIdx = queue.length;
        queue.push({ positions: newPos, parentIdx: currentIdx, move: toNotation(plate.id, dir, 1) });

        if (newPos.every((p, i) => p === goalPos[i])) {
          return { solution: compressPath(reconstructPath(queue, newIdx)), iters: iter };
        }
      }
    }
  }

  return { solution: null, iters: iter };
}
```

- [ ] Update solve handler — send single progress delta after BFS returns:

```js
if (data.type === 'solve') {
  const { solution, iters } = bfsSolve(data.plates);
  self.postMessage({ type: 'progress', itersDelta: iters });
  self.postMessage({ type: 'solve', solution });
}
```

- [ ] Verify solve still works: generate easy puzzle → click РЕШЕНИЕ → solution displayed correctly.

- [ ] Commit: `perf: BFS head-index + parent pointers, O(1) dequeue`

---

## Task 2: Worker random protocol update

**File:** `index.html`, worker-src section, `onmessage` random branch.

Worker now receives `workerId` and `maxAttempts`. Sends deltas after each BFS call. No `iterOffset` — removed with the periodic progress.

- [ ] Replace random handler in worker-src:

```js
if (data.type === 'random') {
  const ALL_COUNTS = [2, 3, 4, 5, 6, 7, 8];
  const PLATE_COUNTS = ALL_COUNTS.filter(c => c >= (data.minPlates || 2));
  const positions   = data.positions;
  const minSteps    = data.minSteps    || 0;
  const maxSteps    = data.maxSteps    || Infinity;
  const workerId    = data.workerId;
  const maxAttempts = data.maxAttempts;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const count = PLATE_COUNTS[Math.floor(Math.random() * PLATE_COUNTS.length)];
    const plates = Array.from({ length: count }, (_, i) => {
      const id     = i + 1;
      const others = Array.from({ length: count }, (_, j) => j + 1).filter(j => j !== id);
      const depCount = Math.floor(Math.random() * 3);
      const used = new Set();
      const deps = [];
      for (let d = 0; d < depCount; d++) {
        const avail = others.filter(x => !used.has(x));
        if (!avail.length) break;
        const targetId = avail[Math.floor(Math.random() * avail.length)];
        used.add(targetId);
        deps.push({ targetId, direction: Math.random() < 0.5 ? 'same' : 'opposite', steps: 1 });
      }
      return { id, positions, deps, currentPos: 1 + Math.floor(Math.random() * positions) };
    });

    if (plates.every(p => p.currentPos === center(p.positions))) {
      self.postMessage({ type: 'progress', workerId, attemptsDelta: 1, itersDelta: 0 });
      continue;
    }

    const { solution, iters } = bfsSolve(plates);
    self.postMessage({ type: 'progress', workerId, attemptsDelta: 1, itersDelta: iters });

    if (solution !== null && solution.length >= minSteps && solution.length <= maxSteps) {
      self.postMessage({ type: 'random-found', workerId, plates, solution });
      return;
    }
  }

  self.postMessage({ type: 'random-exhausted', workerId });
}
```

- [ ] Commit: `feat: worker random protocol — workerId, deltas, random-found/exhausted`

---

## Task 3: Overlay HTML + CSS for per-thread breakdown

**File:** `index.html`, HTML section (~line 529) and CSS (~line 211).

- [ ] Replace `<div id="overlay-progress"></div>` with:

```html
<div id="overlay-progress">
  <div id="progress-total"></div>
  <div id="progress-threads"></div>
</div>
```

- [ ] Add CSS:

```css
#progress-total {
  font-size: 0.82em; color: var(--text-muted); letter-spacing: 1px;
  text-align: center;
}
#progress-threads {
  display: flex; flex-direction: column; gap: 2px; margin-top: 6px;
  font-size: 0.72em; color: var(--text-muted); opacity: 0.7;
}
.progress-thread-row {
  display: flex; gap: 8px; justify-content: center;
}
.progress-thread-id { min-width: 24px; opacity: 0.5; }
```

- [ ] Fix `hideOverlay()` — must not set `textContent` on the container (would destroy children):

```js
function hideOverlay() {
  document.getElementById('computing-overlay').classList.remove('active');
  document.getElementById('progress-total').textContent = '';
  document.getElementById('progress-threads').innerHTML = '';
}
```

- [ ] Commit: `feat: overlay progress — structured HTML for total + per-thread`

---

## Task 4: createWorker — remove default onmessage

**File:** `index.html`, Script #9.

`createWorker()` currently sets `w.onmessage = onWorkerMessage`. Pool workers immediately overwrite this, which is wasteful and misleading. Move the assignment to the callsite.

- [ ] Update `createWorker()`:

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

- [ ] Update the solve worker initialisation (was implicit, now explicit):

```js
let worker = createWorker();
worker.onmessage = onWorkerMessage;
```

- [ ] Commit: `refactor: createWorker no longer sets onmessage`

---

## Task 5: Main thread pool management + progress tracking

**File:** `index.html`, Script #9.

**Key fix:** `poolId` must capture the value at pool-creation time, not a reference to the variable. A closure over `let randomPoolId` reads the current value at call time, so `poolId !== randomPoolId` would always be false — stale detection would never fire.

- [ ] Add globals after `worker.onmessage = onWorkerMessage;`:

```js
let randomPool   = [];
let randomPoolId = 0;

const _perWorker  = {};   // workerId -> { attempts, iters }
let _totalAttempts = 0;
let _totalIters    = 0;
let _poolSize      = 0;
let _maxAttempts   = 0;
let _exhaustedCount = 0;
```

- [ ] Add pool helpers — note `capturedId` fixes the closure bug:

```js
function createRandomPool() {
  const n = Math.min(navigator.hardwareConcurrency || 2, 8);
  const capturedId = randomPoolId;   // snapshot value, not reference
  randomPool = Array.from({ length: n }, (_, i) => {
    const w = createWorker();
    w.onmessage = (e) => onRandomPoolMessage(e, capturedId, i);
    return w;
  });
  return randomPool.length;
}

function terminateRandomPool() {
  randomPool.forEach(w => w.terminate());
  randomPool = [];
}
```

- [ ] Add `renderPoolProgress()` — updates rows in-place to avoid flicker:

```js
function renderPoolProgress() {
  document.getElementById('progress-total').textContent =
    'Попытки: ' + _totalAttempts + ' / ' + _maxAttempts +
    ' · ' + fmtK(_totalIters);

  const threadsEl = document.getElementById('progress-threads');
  for (const [id, s] of Object.entries(_perWorker)) {
    let row = threadsEl.querySelector('.progress-thread-row[data-id="' + id + '"]');
    if (!row) {
      row = document.createElement('div');
      row.className = 'progress-thread-row';
      row.dataset.id = id;
      row.innerHTML = '<span class="progress-thread-id">#' + (parseInt(id) + 1) + '</span><span></span>';
      threadsEl.appendChild(row);
    }
    row.querySelector('span:last-child').textContent =
      s.attempts + ' попыток · ' + fmtK(s.iters);
  }
}
```

- [ ] Add `onRandomPoolMessage`:

```js
function onRandomPoolMessage({ data }, poolId, workerId) {
  if (poolId !== randomPoolId) return;   // stale — pool was replaced

  if (data.type === 'progress') {
    if (!_perWorker[workerId]) _perWorker[workerId] = { attempts: 0, iters: 0 };
    _perWorker[workerId].attempts += data.attemptsDelta || 0;
    _perWorker[workerId].iters    += data.itersDelta    || 0;
    _totalAttempts += data.attemptsDelta || 0;
    _totalIters    += data.itersDelta    || 0;
    renderPoolProgress();
    return;
  }

  if (data.type === 'random-found') {
    randomPoolId++;
    terminateRandomPool();
    hideOverlay();
    resetButtons();
    state.plates = data.plates;
    state.cachedSolution = data.solution;
    state.activePlate = 1;
    document.getElementById('val-plates').textContent = data.plates.length;
    renderMatrix();
    buildScene('scene-config-inner', state.plates);
    updateScene('scene-config-inner', state.plates, state.activePlate);
    document.getElementById('btn-plates-dec').disabled = data.plates.length <= 2;
    document.getElementById('btn-pos-dec').disabled = getPositions() <= 3;
    return;
  }

  if (data.type === 'random-exhausted') {
    _exhaustedCount++;
    if (_exhaustedCount >= _poolSize) {
      randomPoolId++;
      terminateRandomPool();
      hideOverlay();
      resetButtons();
      showToast('Не удалось сгенерировать конфигурацию', 'error');
    }
  }
}
```

- [ ] Update `resetProgress()` — clears pool stats and progress DOM; drop dead `_progressAttempt`:

```js
function resetProgress() {
  _progressStates = null;
  Object.keys(_perWorker).forEach(k => delete _perWorker[k]);
  _totalAttempts = 0; _totalIters = 0; _exhaustedCount = 0;
  document.getElementById('progress-total').textContent = '';
  document.getElementById('progress-threads').innerHTML = '';
}
```

- [ ] Commit: `feat: random worker pool management and per-thread progress tracking`

---

## Task 6: Wire difficulty buttons to pool

**File:** `index.html`, Script #5 `wireConfigHandlers`.

`_maxAttempts` is set to the actual budget (`perWorker * poolSize`) so the display denominator is always accurate.

- [ ] Replace the `.btn-difficulty` click handler:

```js
document.querySelectorAll('.btn-difficulty').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-difficulty').forEach(b => b.disabled = true);
    resetProgress();
    document.getElementById('computing-overlay').classList.add('active');

    randomPoolId++;
    terminateRandomPool();

    _poolSize = createRandomPool();
    const perWorker = Math.ceil(400 / _poolSize);
    _maxAttempts = perWorker * _poolSize;   // actual budget, not 400

    randomPool.forEach((w, i) => {
      w.postMessage({
        type:        'random',
        workerId:    i,
        positions:   getPositions(),
        minSteps:    parseInt(btn.dataset.min),
        maxSteps:    btn.dataset.max ? parseInt(btn.dataset.max) : Infinity,
        minPlates:   parseInt(btn.dataset.plates) || 2,
        maxAttempts: perWorker,
      });
    });
  });
});
```

- [ ] Update cancel button handler to terminate pool and recreate solve worker:

```js
document.querySelector('#computing-overlay .btn-cancel').addEventListener('click', () => {
  // cancel solve if running
  worker.terminate();
  worker = createWorker();
  worker.onmessage = onWorkerMessage;
  // cancel random pool if running
  randomPoolId++;
  terminateRandomPool();
  hideOverlay();
  resetButtons();
});
```

- [ ] Commit: `feat: wire difficulty buttons to random worker pool`

---

## Task 7: onWorkerMessage — solve-only path cleanup

`onWorkerMessage` currently handles both solve and random. After Task 5, random messages go to `onRandomPoolMessage`. Rewrite to only handle solve.

- [ ] Replace `onWorkerMessage`:

```js
function onWorkerMessage({ data }) {
  if (data.type === 'progress') {
    _progressStates = (_progressStates || 0) + (data.itersDelta || 0);
    document.getElementById('progress-total').textContent =
      'Состояний проверено: ' + fmtK(_progressStates);
    return;
  }

  hideOverlay();

  if (data.type === 'solve') {
    const btn = document.getElementById('btn-start');
    btn.disabled = false; btn.textContent = 'РЕШЕНИЕ';
    if (data.solution === null) {
      showToast('Решение не найдено', 'error');
      return;
    }
    state.solution = data.solution;
    state.solverStep = 0;
    state.history = [];
    switchToSolve();
  }
}
```

- [ ] Remove the old `data.type === 'random'` branch from `onWorkerMessage`.

- [ ] Commit: `refactor: onWorkerMessage solve-only, random handled by pool`

---

## Task 8: Smoke test

- [ ] Easy: generate → result appears, progress breakdown shows N threads.
- [ ] Hard: generate → progress counts up per-thread, first winner terminates pool.
- [ ] Cancel during random → overlay closes, buttons reset, subsequent generation works.
- [ ] Generate → cancel → generate again → poolId correctly blocks stale messages from old pool.
- [ ] Solve → "Состояний проверено: N тыс." appears → solution found.
- [ ] 8 plates solve → no UI freeze (BFS runs in worker).
