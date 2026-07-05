import { test, expect } from '@playwright/test';
import { startSolve } from './helpers.js';

// Unit tests for the solver core (bfsSolveGrouped / compressPath), exercised as
// page globals from the shared solver-src script — the exact same source text
// that createWorker injects into the Web Worker Blob.
//
// bfsSolveGrouped is the ONE solver: minimal keypress count (BFS depth), and
// among all minimal-move solutions the fewest switches between plates.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('bfsSolveGrouped', () => {
  // Gothic-format reference configs with externally verified optima:
  // SITE_CFG comes from unlockmyloot.com (their exact solver shows 11 groups
  // over the same 41 keypresses), REF1_CFG is our in-game reference.
  const SITE_CFG = '040615 A:C-;B:C+,D-;D:E-,C+;E:F-;F:E+,B-';
  const REF1_CFG = '3055665 A:C+,D+;B:A-,E-,G+;D:B-;E:D-;F:B-;G:A+,B-';

  test('solution for a dependency config replays to all-centered', async ({ page }) => {
    const result = await page.evaluate(() => {
      const plates = [
        { id: 1, positions: 7, currentPos: 2, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
        { id: 2, positions: 7, currentPos: 6, deps: [{ targetId: 3, direction: 'opposite', steps: 1 }] },
        { id: 3, positions: 7, currentPos: 4, deps: [] },
      ];
      const { solution } = bfsSolveGrouped(plates);
      if (solution === null) return { solution: null };
      const replay = plates.map(p => ({ ...p, deps: p.deps.map(d => ({ ...d })) }));
      for (const step of solution) {
        const { plateId, dir, steps } = parseNotation(step);
        for (let i = 0; i < steps; i++) {
          if (!applyMove(replay, plateId, dir)) return { solution, blocked: step };
        }
      }
      return { solution, final: replay.map(p => p.currentPos) };
    });

    expect(result.solution).not.toBeNull();
    expect(result.blocked).toBeUndefined();
    expect(result.final).toEqual([4, 4, 4]); // center of 7 positions
  });

  test('finds the minimal solution on a hand-checked config', async ({ page }) => {
    const solution = await page.evaluate(() => {
      // Plate 1 at 3 pulls plate 2 (same); both are one left-move from center
      const plates = [
        { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
        { id: 2, positions: 7, currentPos: 3, deps: [] },
      ];
      return bfsSolveGrouped(plates).solution;
    });
    expect(solution).toEqual(['1A']); // exactly one move — anything longer is non-minimal
  });

  test('returns null for an unsolvable config and [] for a solved one', async ({ page }) => {
    const res = await page.evaluate(() => {
      // Mutual same-deps: the two plates always move together, so their offset
      // (1 apart) can never close — no state with both centered is reachable.
      const stuck = [
        { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
        { id: 2, positions: 7, currentPos: 4, deps: [{ targetId: 1, direction: 'same', steps: 1 }] },
      ];
      const solved = [
        { id: 1, positions: 7, currentPos: 4, deps: [] },
        { id: 2, positions: 7, currentPos: 4, deps: [] },
      ];
      return [bfsSolveGrouped(stuck).solution, bfsSolveGrouped(solved).solution];
    });
    expect(res).toEqual([null, []]);
  });

  test('respects all-or-nothing blocking through dependencies', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Plate 1 drags plate 2 the same way; plate 2 starts at the right edge (1),
      // so moving plate 1 right is blocked — the solver must route around it.
      const plates = [
        { id: 1, positions: 7, currentPos: 5, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
        { id: 2, positions: 7, currentPos: 1, deps: [] },
      ];
      const { solution } = bfsSolveGrouped(plates);
      if (solution === null) return { solution: null };
      const replay = plates.map(p => ({ ...p, deps: p.deps.map(d => ({ ...d })) }));
      for (const step of solution) {
        const { plateId, dir, steps } = parseNotation(step);
        for (let i = 0; i < steps; i++) {
          if (!applyMove(replay, plateId, dir)) return { solution, blocked: step };
        }
      }
      return { solution, final: replay.map(p => p.currentPos) };
    });
    expect(result.solution).not.toBeNull();
    expect(result.blocked).toBeUndefined();
    expect(result.final).toEqual([4, 4]);
  });

  test('site config: minimal 41 keypresses in the optimal 11 groups', async ({ page }) => {
    const res = await page.evaluate((cfg) => {
      const sol = bfsSolveGrouped(parseImportConfig(cfg)).solution;
      return { groups: sol.length, raw: sol.reduce((a, s) => a + parseNotation(s).steps, 0) };
    }, SITE_CFG);
    // 41 keypresses and 11 groups are both externally verified optima
    expect(res.raw).toBe(41);
    expect(res.groups).toBe(11);
  });

  test('in-game reference: minimal 23 keypresses in the optimal 8 groups', async ({ page }) => {
    const res = await page.evaluate((cfg) => {
      const sol = bfsSolveGrouped(parseImportConfig(cfg)).solution;
      return { groups: sol.length, raw: sol.reduce((a, s) => a + parseNotation(s).steps, 0) };
    }, REF1_CFG);
    expect(res.raw).toBe(23);
    expect(res.groups).toBe(8);
  });
});

test.describe('compressPath', () => {
  test('collapses consecutive same-plate same-direction moves', async ({ page }) => {
    const out = await page.evaluate(() => compressPath(['1A', '1A', '1A', '2D', '1A']));
    expect(out).toEqual(['1A3', '2D', '1A']);
  });

  test('keeps an empty path empty and single moves untouched', async ({ page }) => {
    const out = await page.evaluate(() => [compressPath([]), compressPath(['3D'])]);
    expect(out).toEqual([[], ['3D']]);
  });
});

test.describe('worker equivalence', () => {
  test('the real worker returns the same solution as the in-page solver', async ({ page }) => {
    // Structural guarantee is single-source injection; this is the runtime proof:
    // solving the same config in the page and through the actual Web Worker
    // (SOLVE button) must produce identical move lists.
    const CONFIG = JSON.stringify([
      { id: 1, positions: 7, currentPos: 2, deps: [{ targetId: 2, direction: 'opposite', steps: 1 }] },
      { id: 2, positions: 7, currentPos: 5, deps: [] },
      { id: 3, positions: 7, currentPos: 6, deps: [{ targetId: 1, direction: 'same', steps: 1 }] },
    ]);
    const inPage = await page.evaluate((cfg) => bfsSolveGrouped(JSON.parse(cfg)).solution, CONFIG);
    await startSolve(page, CONFIG);
    const fromWorker = await page.evaluate(() => state.solution);
    expect(fromWorker).toEqual(inPage);
    expect(inPage).not.toBeNull();
  });

  test('the randomizer caches the same solution the solve path would produce', async ({ page }) => {
    // One solver everywhere: the solution cached by random generation must be
    // exactly what bfsSolveGrouped yields for the generated config — otherwise
    // a randomized config would show a differently-grouped sequence than the
    // same config imported by hand.
    await page.getByTestId('btn-easy').click();
    await expect(page.getByTestId('btn-easy')).toBeEnabled({ timeout: 30000 }); // generation done
    const res = await page.evaluate(() => {
      const config = state.plates.map(p => ({ ...p, deps: p.deps.map(d => ({ ...d })) }));
      return { cached: state.cachedSolution, recomputed: bfsSolveGrouped(config).solution };
    });
    expect(res.cached).toEqual(res.recomputed);
  });
});
