import { test, expect } from '@playwright/test';
import { startSolve } from './helpers.js';

// Unit tests for the solver core (bfsSolve / compressPath), exercised as page
// globals from the shared solver-src script — the exact same source text that
// createWorker injects into the Web Worker Blob.

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const mkPlate = (id, currentPos, deps = []) => ({ id, positions: 7, currentPos, deps });

test.describe('bfsSolve', () => {
  test('solution for a dependency config replays to all-centered', async ({ page }) => {
    const result = await page.evaluate(() => {
      const plates = [
        { id: 1, positions: 7, currentPos: 2, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
        { id: 2, positions: 7, currentPos: 6, deps: [{ targetId: 3, direction: 'opposite', steps: 1 }] },
        { id: 3, positions: 7, currentPos: 4, deps: [] },
      ];
      const { solution } = bfsSolve(plates);
      if (solution === null) return { solution: null };
      // Replay the compressed solution through the page's applyMove
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
      return bfsSolve(plates).solution;
    });
    expect(solution).toEqual(['1A']); // exactly one move — anything longer is non-minimal
  });

  test('returns null for an unsolvable config', async ({ page }) => {
    const solution = await page.evaluate(() => {
      // Mutual same-deps: the two plates always move together, so their offset
      // (1 apart) can never close — no state with both centered is reachable.
      const plates = [
        { id: 1, positions: 7, currentPos: 3, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
        { id: 2, positions: 7, currentPos: 4, deps: [{ targetId: 1, direction: 'same', steps: 1 }] },
      ];
      return bfsSolve(plates).solution;
    });
    expect(solution).toBeNull();
  });

  test('returns an empty solution for an already-solved config', async ({ page }) => {
    const solution = await page.evaluate(() => {
      const plates = [
        { id: 1, positions: 7, currentPos: 4, deps: [] },
        { id: 2, positions: 7, currentPos: 4, deps: [] },
      ];
      return bfsSolve(plates).solution;
    });
    expect(solution).toEqual([]);
  });

  test('respects all-or-nothing blocking through dependencies', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Plate 1 drags plate 2 the same way; plate 2 starts at the right edge (1),
      // so moving plate 1 right is blocked — the solver must route around it.
      const plates = [
        { id: 1, positions: 7, currentPos: 5, deps: [{ targetId: 2, direction: 'same', steps: 1 }] },
        { id: 2, positions: 7, currentPos: 1, deps: [] },
      ];
      const { solution } = bfsSolve(plates);
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
    const inPage = await page.evaluate((cfg) => bfsSolve(JSON.parse(cfg)).solution, CONFIG);
    await startSolve(page, CONFIG);
    const fromWorker = await page.evaluate(() => state.solution);
    expect(fromWorker).toEqual(inPage);
    expect(inPage).not.toBeNull();
  });
});
