import { test, expect } from '@playwright/test';
import { startSolve } from './helpers.js';

// Characterization tests for the findings of the full-file review (2026-07-25).
// Each test pins the DESIRED behaviour, so a failing test here == a confirmed bug.
// Once a finding is fixed the test turns green and stays as its regression guard.

test.beforeEach(async ({ page }) => { await page.goto('/'); });

const DEP_CONFIG = '040615 A:B-,C+;D:E-';   // 6 plates, 3 dep groups, real solution

// ── validatePlates hardening ─────────────────────────────────────────────────

test('F7: validatePlates rejects plates whose array order differs from id order', async ({ page }) => {
  // The solver reads positions by array index but writes them by id (np[plateId-1]),
  // so an out-of-order array silently corrupts every consumer.
  const r = await page.evaluate(() => {
    const cfg = [
      { id: 2, positions: 7, currentPos: 2, deps: [] },
      { id: 1, positions: 7, currentPos: 6, deps: [] },
    ];
    return { accepted: validatePlates(cfg) !== null, solved: bfsSolveGrouped(cfg).solution };
  });
  expect(r.accepted).toBe(false);   // must be rejected (or normalised) before it reaches the solver
});

test('F14: validatePlates rejects a fractional currentPos', async ({ page }) => {
  const accepted = await page.evaluate(() => validatePlates([
    { id: 1, positions: 7, currentPos: 3.5, deps: [] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]) !== null);
  expect(accepted).toBe(false);
});

test('F14b: validatePlates rejects a fractional positions count', async ({ page }) => {
  const accepted = await page.evaluate(() => validatePlates([
    { id: 1, positions: 7.5, currentPos: 4, deps: [] },
    { id: 2, positions: 7.5, currentPos: 4, deps: [] },
  ]) !== null);
  expect(accepted).toBe(false);
});

test('F8: validatePlates rejects an absurd positions count instead of letting it reach the renderer', async ({ page }) => {
  const accepted = await page.evaluate(() => validatePlates([
    { id: 1, positions: 9007199254740991, currentPos: 3, deps: [] },
    { id: 2, positions: 9007199254740991, currentPos: 4, deps: [] },
  ]) !== null);
  expect(accepted).toBe(false);
});

test('F8b: applying a config the app accepted never throws out of the import path', async ({ page }) => {
  // Whatever validatePlates lets through must survive buildScene.
  const err = await page.evaluate(() => {
    const cfg = JSON.stringify([
      { id: 1, positions: 9007199254740991, currentPos: 3, deps: [] },
      { id: 2, positions: 9007199254740991, currentPos: 4, deps: [] },
    ]);
    const plates = parseConfig(cfg);
    if (!plates) return null;              // rejected up front → fine
    try { applyPlates(plates); return null; } catch (e) { return String(e); }
  });
  expect(err).toBeNull();
});

test('F23: validatePlates rejects a dep whose steps exceed the lock size', async ({ page }) => {
  const accepted = await page.evaluate(() => validatePlates([
    { id: 1, positions: 7, currentPos: 4, deps: [{ targetId: 2, direction: 'same', steps: 99 }] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]) !== null);
  expect(accepted).toBe(false);
});

// ── codec contract ───────────────────────────────────────────────────────────

test('F29: the drum infers the digit base from boundary digits', async ({ page }) => {
  // A 0 can only be 0-based (0-based range is 0..6); a 7 can only be 1-based (1..7);
  // digits 1..6 alone are ambiguous and the drum — which sets the values it displays —
  // treats them as 1-based. Today every pasted digit is read 1-based and a 0 is silently
  // clamped to 1, so a 0-based copy like "0246" lands on the wrong holes.
  const paste = async (text) => {
    await page.getByTestId('pos-input-1').click();
    await page.evaluate((t) => {
      const el = document.querySelector('[data-test-id="pos-input-1"]');
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
    return page.evaluate(() => state.plates.map(p => p.currentPos));
  };
  expect(await paste('0246')).toEqual([1, 3, 5, 7]);   // has a 0 → 0-based
  expect(await paste('7143')).toEqual([7, 1, 4, 3]);   // has a 7 → 1-based
  expect(await paste('3333')).toEqual([3, 3, 3, 3]);   // ambiguous → 1-based
});

// F2 (Ctrl+C → Ctrl+V of a dep-free config reports «Невалидный конфиг») was WITHDRAWN:
// per the codec spec bare digits are deliberately NOT an import config but the separate
// drum-input path, and gothic's inability to re-import them is a documented Known
// limitation. The only wrong part is the bogus toast, which F15 (gating the global paste
// on looksLikeImportConfig) removes. The 0-based/1-based collision this uncovered — a
// gothic copy is 0-based, the drum reads pasted digits as its 1-based display values, so
// a copy→paste-into-drum cycle shifts every disc by one — is a semantics question, not a
// defect; recorded in docs/review/2026-07-25-improvements.md for a decision.

test('F11: out-of-range position digits are rejected, not clamped', async ({ page }) => {
  // '789' means 0-based positions 8/9/10 on a 7-hole lock — impossible, so it must not
  // import. dotted already ends at null via validatePlates; gothic clamps to 7 instead.
  const r = await page.evaluate(() => ({
    gothicApp: parseConfig('789 A:B-'),
    dottedApp: parseConfig('3.789.aaaaaa'),
    gothicRaw: Codecs.gothic.parse('789 A:B-'),
  }));
  expect(r.dottedApp).toBeNull();
  expect(r.gothicApp).toBeNull();
  expect(r.gothicRaw).toBeNull();
});

// F21 (bytearray.serialize truncating a >7 pin) was WITHDRAWN after checking
// docs/superpowers/specs/2026-07-17-config-format-parsers-design.md: serialize is
// specified to return null only for n < 3, and non-7 hole counts are a documented
// accepted constraint ("round-trips only through json/gothic"), enforced by
// validatePlates. Pinning positions to 7 (F8) makes the truncation unreachable.

test('F24: no codec throws on a non-string argument (never-throws contract)', async ({ page }) => {
  const thrown = await page.evaluate(() => {
    const out = [];
    for (const id of ['json', 'gothic', 'dotted', 'bytearray']) {
      for (const bad of [null, undefined, 42, {}]) {
        try { Codecs[id].parse(bad); } catch (e) { out.push(`${id}(${typeof bad})`); }
      }
    }
    return out;
  });
  expect(thrown).toEqual([]);
});

test('F9: every config the app accepts round-trips through the ?lock URL', async ({ page }) => {
  // The original finding (the app writing a lock it then rejects as corrupted) is only
  // reachable with a positions !== 7 config, which validatePlates now refuses outright.
  // So pin the invariant that actually matters: anything that passes the gate must survive
  // urlQueryFor → urlReadConfig unchanged, at every plate count and both boundary holes.
  const bad = await page.evaluate(() => {
    const fails = [];
    for (let n = 2; n <= 8; n++) {
      for (const pos of [1, 7, 4]) {                 // both boundary holes and the centre
        const plates = Array.from({ length: n }, (_, i) => ({
          id: i + 1, positions: 7, currentPos: pos,
          deps: i === 0 && n > 1 ? [{ targetId: 2, direction: 'opposite', steps: 1 }] : [],
        }));
        if (!validatePlates(plates)) { fails.push(`gate rejected n=${n} pos=${pos}`); continue; }
        const back = urlReadConfig(urlQueryFor(plates, 'config'));
        if (!back || JSON.stringify(back.plates) !== JSON.stringify(plates)) {
          fails.push(`n=${n} pos=${pos}`);
        }
      }
    }
    return fails;
  });
  expect(bad).toEqual([]);
});

// ── auto-play lifecycle ──────────────────────────────────────────────────────

test('F3: jumping to a step stops auto-play', async ({ page }) => {
  await startSolve(page, DEP_CONFIG);
  await page.getByTestId('btn-auto').click();
  await page.getByTestId('step-start').click();
  expect(await page.evaluate(() => state.autoInterval)).toBeNull();
});

test('F3b: auto-play clears its interval when it reaches the end', async ({ page }) => {
  await startSolve(page, DEP_CONFIG);
  await page.getByTestId('btn-auto').click();
  await expect(page.getByTestId('step-end')).toHaveClass(/active/, { timeout: 20000 });
  expect(await page.evaluate(() => state.autoInterval)).toBeNull();
});

test('F22: leaving the solve stage mid-play resets the Auto button label', async ({ page }) => {
  await startSolve(page, DEP_CONFIG);
  await page.getByTestId('btn-auto').click();
  await page.getByTestId('btn-back').click();
  await expect(page.getByTestId('btn-auto')).not.toContainText('Стоп');
});

// ── explore state machine ────────────────────────────────────────────────────

test('F12: undoing every explore move returns to following mode', async ({ page }) => {
  await startSolve(page, DEP_CONFIG);
  await page.keyboard.press('a');            // left is the unblocked direction here
  await expect(page.getByTestId('explore-separator')).toBeVisible();   // detach really happened
  await page.keyboard.press('d');            // exact undo → history empty again
  const r = await page.evaluate(() => ({ mode: state.solveMode, len: state.exploreHistory.length }));
  expect(r.len).toBe(0);
  expect(r.mode).toBe('following');
});

test('F18: switchToConfig resets the explore state machine', async ({ page }) => {
  await startSolve(page, DEP_CONFIG);
  await page.keyboard.press('a');             // detach into exploring (left is unblocked here)
  await expect(page.getByTestId('explore-separator')).toBeVisible();   // detach really happened
  await page.getByTestId('btn-back').click();
  const r = await page.evaluate(() => ({
    mode: state.solveMode, len: state.exploreHistory.length, detach: state.detachStep,
  }));
  expect(r).toEqual({ mode: 'following', len: 0, detach: null });
});

// ── config mutation points vs the URL ────────────────────────────────────────

test('F5: a randomly generated config is persisted to the URL', async ({ page }) => {
  await page.getByTestId('pos-inc-1').click();          // establish a known lock in the URL
  await page.getByTestId('btn-easy').click();
  await page.waitForFunction(
    () => !document.getElementById('computing-overlay').classList.contains('active'),
    null, { timeout: 30000 });
  const r = await page.evaluate(() => ({
    live: Codecs.dotted.serialize(state.plates),
    inUrl: new URLSearchParams(location.search).get('lock'),
  }));
  expect(r.inUrl).toBe(r.live);
});

test('F6: a config pasted into the drum with deps set takes only the digits, keeps the matrix, and says so', async ({ page }) => {
  // Decided rule: the drum applies a whole clipboard config ONLY when the matrix is
  // empty; with any dep set it takes just the digits (so the matrix is not overwritten)
  // and tells the user the config was not applied. Positions land in place while the
  // plate count is unchanged — deps only reset when the count itself changes.
  await page.evaluate((c) => openImportDialog(c), DEP_CONFIG);
  await page.getByTestId('import-dialog-ok').click();
  const before = await page.evaluate(() => ({
    deps: state.plates.reduce((n, p) => n + p.deps.length, 0),
    n: state.plates.length,
  }));
  expect(before.deps).toBeGreaterThan(0);

  await page.getByTestId('pos-input-1').click();
  await page.evaluate(() => {
    const el = document.querySelector('[data-test-id="pos-input-1"]');
    const dt = new DataTransfer();
    dt.setData('text/plain', '531505');            // 6 digits — same plate count, 0-based run
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const after = await page.evaluate(() => ({
    deps: state.plates.reduce((n, p) => n + p.deps.length, 0),
    n: state.plates.length,
    pos: state.plates.map(p => p.currentPos),
  }));
  expect(after.n).toBe(before.n);
  expect(after.deps).toBe(before.deps);           // matrix survives a digits-only paste
  expect(after.pos).toEqual([6, 4, 2, 6, 1, 6]);  // digits applied (0-based → +1)
  await expect(page.getByTestId('toast')).toBeVisible();   // told that the config was not applied
});

test('F1: applying a search result while solving leaves state, DOM and URL in agreement', async ({ page }) => {
  await page.evaluate(async () => { await chestSearchReady; });
  await startSolve(page, DEP_CONFIG);
  const entry = await page.evaluate(() => {
    const e = chestDb.entries.find(x => x.pos.length !== 6);   // a different plate count
    applySearchResult(e);
    return { cells: e.pos.length };
  });
  const r = await page.evaluate(() => ({
    stateLen: state.plates.length,
    valPlates: document.getElementById('val-plates').textContent,
    inputs: document.querySelectorAll('#plates-positions .poslock-digit').length,
    urlLen: (urlReadConfig() || {}).plates?.length,
  }));
  expect(r.stateLen).toBe(entry.cells);
  expect(Number(r.valPlates)).toBe(entry.cells);
  expect(r.inputs).toBe(entry.cells);
  expect(r.urlLen).toBe(entry.cells);
});

// ── solve lifecycle vs the URL ───────────────────────────────────────────────

test('F10: an unsolvable &solve deep link does not keep the flag in the URL', async ({ page }) => {
  // 3.364.asssos is genuinely unsolvable (brute-forced against bfsSolveGrouped).
  await page.goto('/?lock=3.364.asssos&solve');
  await expect(page.getByTestId('toast')).toBeVisible({ timeout: 20000 });
  expect(new URL(page.url()).searchParams.has('solve')).toBe(false);
});

test('F4: changing the config invalidates any in-flight solve', async ({ page }) => {
  // The crisp invariant behind the bug: a config swap must make a pending worker
  // result unacceptable, i.e. bump the id the result is matched against.
  const r = await page.evaluate(() => {
    const before = solveId;
    applyPlates(parseConfig('012 A:B-'));
    return { before, after: solveId };
  });
  expect(r.after).not.toBe(r.before);
});

// ── paste gating ─────────────────────────────────────────────────────────────

test('F15: Ctrl+V with text that is not a config does not open the import dialog', async ({ page }) => {
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'просто какой-то текст');
    document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.getByTestId('import-dialog')).toBeHidden();
});

// ── search readiness ─────────────────────────────────────────────────────────

test('F16: a malformed chest DB leaves the search gracefully unavailable, not silently dead', async ({ browser, baseURL }) => {
  // A FRESH context on purpose: reusing the beforeEach page would defeat the mock twice
  // over — via the localStorage cache and via the browser's HTTP cache for chests.json
  // (both gotchas are documented in CLAUDE.md).
  const ctx = await browser.newContext({ baseURL });
  const fresh = await ctx.newPage();
  await fresh.route('**/chests.json', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"nope":1}',
                    headers: { 'Cache-Control': 'no-store' } }));
  await fresh.goto('/');
  const settled = await fresh.evaluate(() =>
    chestSearchReady.then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e) })));
  expect(settled.ok).toBe(true);          // the readiness promise must not reject
  expect(settled.v).toBe(false);          // it resolves to "unavailable"
  await expect(fresh.getByTestId('btn-search-db')).toBeDisabled();
  await ctx.close();
});

// ── solve panel consistency ──────────────────────────────────────────────────

test('F19: the notation string and the step list highlight the same step', async ({ page }) => {
  await startSolve(page, DEP_CONFIG);
  await page.getByTestId('btn-step').click();          // solverStep = 1
  const r = await page.evaluate(() => ({
    stringCur: document.querySelector('#solution-string .cur-step')?.textContent,
    listActive: document.querySelector('#solution-steps li.active [data-test-id="step-notation"]')?.textContent,
  }));
  expect(r.stringCur).toBe(r.listActive);
});

test('F28: an already-centred lock never shows two active rows', async ({ page }) => {
  // Originally both endpoint cards resolved to step 0 and both lit up. An empty solution
  // now renders the already-solved notice instead of endpoints (see solve-flow.spec.js),
  // so the double highlight cannot arise at all — this guards that invariant either way.
  await startSolve(page, JSON.stringify([
    { id: 1, positions: 7, currentPos: 4, deps: [] },
    { id: 2, positions: 7, currentPos: 4, deps: [] },
  ]));
  const active = await page.evaluate(() =>
    [...document.querySelectorAll('#solution-steps li.active')].map(li => li.dataset.testId));
  expect(active.length).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('solve-already-solved')).toBeVisible();
});

// ── DB rendering ─────────────────────────────────────────────────────────────

test('F27: a chest image value cannot break out of its HTML attribute', async ({ page }) => {
  const injected = await page.evaluate(() => {
    const entry = { id: 'x', name: { ru: 'x' }, cells: 2, rules: '', pos: [1, 2], tags: [],
                    img: ['x" onerror="window.__pwned=1" data-x="'] };
    const host = document.createElement('div');
    host.innerHTML = buildResultCard(entry, 'probe');
    return host.querySelector('img')?.getAttribute('onerror') !== null;
  });
  expect(injected).toBe(false);
});
