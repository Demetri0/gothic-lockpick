# Improvement findings — for later review (2026-07-25)

Non-bug findings and open questions from the whole-file review of `index.html`. Nothing here breaks
behaviour today; each item is a cleanup, an efficiency note, or a wording nit.
**Correctness defects are not here** — those are in
`docs/superpowers/plans/2026-07-25-review-fixes.md` with red tests in
`tests/review-findings.spec.js`.

Every claim below was re-verified against the code on 2026-07-25 (grep/read shown
per item). Each has a suggested action and my recommendation, but none is decided —
that's the point of this file.

---

## 1. Dead `layers` array in `bfsSolveGrouped` — remove

`index.html:1335-1348`. Re-verified: exactly three occurrences, **all writes**.

```
1335:  const layers = Array.from({ length: L + 1 }, () => []);  // corridor states by distS
1336:  layers[L].push(goalKey);
1348:        layers[ds - 1].push(nk);
```

The corridor DP uses `history`/`layerNodes` and the greedy fallback uses `distG`;
nothing ever reads `layers`. Cost: `L + 1` arrays plus one string push per corridor
state — up to `CORRIDOR_LIMIT` (200 000) entries retained for the whole solve, on
exactly the large locks where the solver is already slowest.

**Action:** delete the three lines. **Recommend: do it** — zero risk, it is provably
unread, and it lives in `solver-src`, which is also injected into the worker (so the
waste is paid twice).

## 2. Dead `state.detachPositions` — remove or start using

`index.html:1649` (declared), `2849`/`3053` (cleared), `3266` (assigned) — **no reads**.

The actual return-to-detach mechanism is `jumpToStep` replaying from
`solveStartPositions`, so the snapshot is never consulted. It advertises a
positional guarantee the code does not rely on, and every detach pays for an array copy.

**Action:** delete the field and its three assignments, or make `returnToSolution`
restore from it. **Recommend: delete** — replaying from the config snapshot is the
single source of truth and already covered by tests.

## 3. `getBlockingPlateId` duplicates `computeMove`'s effect loop — leave as is

`index.html:1710-1726` vs `1237-1262` (four `depSign` occurrences in the file confirm
the duplication: two in the solver, two here).

Both rebuild the same `{plate, delta}` effects array with identical `depSign` logic;
only the terminal differs (blocker id for the UI shake vs. effects for the solver).

**Action:** either surface the first blocker from `computeMove` or extract a shared
effects builder. **Recommend: leave it.** `computeMove` lives in `solver-src`, which is
injected verbatim into the worker and is the hot BFS path; threading UI diagnostics
through it trades a real constraint for ~8 duplicated lines. This is a deliberate
split of solver core from UI feedback, and it should be commented as such rather than
merged. (Same conclusion as the earlier review round.)

## 4. Solver `expand()` allocates per node and resolves plates by `.find()` — measure first

`index.html:1295-1301`:

```js
  const expand = (positions) => {
    const snap = plates.map((p, i) => ({ ...p, currentPos: positions[i] }));
    …
        const effects = computeMove(snap, plate.id, dir);
```

Per expanded node: `N` object spreads, then for each of `2N` candidate moves a
`plates.find(...)` for the primary plate plus one per dependency — roughly O(N²) with
fresh allocations, repeated once per node across three phases over a corridor up to
200 000 states.

**Action:** precompute per-index dependency tables once (`[{targetIdx, signedDelta}]`)
and operate on the raw positions array, dropping both the spread and the `.find`.
**Recommend: measure before touching.** No user has reported slowness, the code is
shared verbatim with the worker (a documented constraint), and the fallback already
caps pathological corridors. Worth doing only if profiling shows the solver dominating
on 7–8 plate locks.

## 5. `showToast` can leak a node when the transition never fires

`index.html:1673-1676`: after 2500 ms the `visible` class is removed and removal waits
on `transitionend` with `{ once: true }`. If no transition runs — `prefers-reduced-motion`
overrides, the tab is backgrounded and throttled, or the element is display-less — the
listener never fires and the node stays in `#toast-container` forever.

**Action:** add a fallback `setTimeout(() => toast.remove(), …)` alongside the
`transitionend` listener. **Recommend: do it** — two lines, removes an unbounded DOM
growth path in a long session.

## 6. Whole 300 KB DB is re-serialised into `localStorage` on every load

`index.html:3600`: `localStorage.setItem('chestDb', JSON.stringify(chestDb))` runs on
every successful fetch, a synchronous main-thread write of the full database at startup.

**Action:** skip the write when the cached copy is already current (compare
`chestDb.updated`/`v` with the cached value before stringifying).
**Recommend: do it together with the quota-handling fix** already listed in the fix
plan (the same `try` currently downgrades a fresh DB to the stale cache on quota errors).

## 7. `cycleActivePlate` wraps oddly when `activePlate` is stale

`index.html:1730-1734`: `ids.indexOf(state.activePlate)` returns `-1` for an id that no
longer exists, and `(-1 + delta + len) % len` then lands on the first plate for `W` and
on the second-to-last for `S`.

**Action:** clamp/guard the `-1` case explicitly (fall back to plate 1).
**Recommend: low priority** — every removal path currently fixes `activePlate`, so this
is defensive only. Worth a one-line guard when the file is next touched.

## 8. Explore separator says "return to step 0" when there is no step 0 card

`index.html:2949`: the separator interpolates `detachStep` verbatim, but step 0 is
rendered as the «Начало» endpoint above it, not a numbered card. Detaching immediately
on entering the solve stage shows «↩ вернуться к шагу 0».

**Action:** special-case `detachStep === 0` to name the start endpoint instead of a
number (needs a new i18n key in all three locales).
**Recommend: do it** — cheap wording fix, and it is the first thing a user sees when they
experiment right after solving.

---

## Not included on purpose

- Anything with a red test in `tests/review-findings.spec.js` — those are defects, tracked
  in the fix plan.
- The drum digit-base question this review raised — **decided and implemented** on
  `fix/review-findings`: the base is inferred from boundary digits, ambiguous runs read as
  1-based. Rule documented in CLAUDE.md and README, guarded by `F29` in
  `tests/review-findings.spec.js`.
- The `positions !== 7` question. It looks like a cleanup ("just pin it to 7") but it is a
  product decision (do we ever want non-7-hole locks?), so it is a decision point in
  Batch 1 of the fix plan instead.
