import { test, expect } from '@playwright/test';

// Solvability sweep over the real chest DB: solve every chest and replay the
// solution to confirm it lands all discs centered. A strong regression net for
// the solver + entryToPlates against real data, but slow (~400 solves), so the
// full sweep is gated behind RUN_CORPUS. A failure reports each offending
// chest's id, cells, rules, pos and final positions so you can reproduce it.
//
//   npm run test:corpus                                   — full sweep (gated, ~3 min)
//   RUN_CORPUS=1 npx playwright test tests/corpus.spec.js — same
//   CHEST=<id-substring> npx playwright test tests/corpus.spec.js  — one/few chests, fast
const ONLY = process.env.CHEST || '';

test(ONLY ? `chest "${ONLY}" solves and replays to all-centered`
          : 'every real chest solves and replays to all-centered', async ({ page }) => {
  test.skip(!ONLY && !process.env.RUN_CORPUS, 'set RUN_CORPUS=1 to sweep the full DB, or CHEST=<id> for one');
  test.setTimeout(ONLY ? 60000 : 600000);
  await page.goto('/');

  const result = await page.evaluate(async (only) => {
    await chestSearchReady;
    const entries = only ? chestDb.entries.filter(e => e.id.includes(only)) : chestDb.entries;
    const failures = [];
    for (const entry of entries) {
      const plates = entryToPlates(entry);
      const info = { id: entry.id, cells: entry.cells, rules: entry.rules, pos: entry.pos };
      const { solution } = bfsSolveGrouped(plates);
      if (solution === null) { failures.push({ ...info, why: 'no solution' }); continue; }

      const replay = plates.map(p => ({ ...p, deps: p.deps.map(d => ({ ...d })) }));
      let blocked = null;
      for (const step of solution) {
        const { plateId, dir, steps } = parseNotation(step);
        for (let i = 0; i < steps; i++) if (!applyMove(replay, plateId, dir)) { blocked = step; break; }
        if (blocked) break;
      }
      const final = replay.map(p => p.currentPos);
      const center = (plates[0].positions + 1) / 2;   // 7 → 4
      if (blocked) failures.push({ ...info, solution, final, why: 'blocked at ' + blocked });
      else if (!final.every(p => p === center)) failures.push({ ...info, solution, final, why: 'not centered' });
    }
    return { tested: entries.length, failures };
  }, ONLY);

  expect(result.tested, `no chest id matched CHEST="${ONLY}"`).toBeGreaterThan(0);

  const shown = result.failures.slice(0, 20).map(f =>
    `  • ${f.id} [cells ${f.cells}] — ${f.why}\n`
    + `     rules=${f.rules}\n     pos=${JSON.stringify(f.pos)}`
    + (f.final ? `\n     final=${JSON.stringify(f.final)}  solution=${JSON.stringify(f.solution)}` : '')
  ).join('\n');
  const more = result.failures.length > 20 ? `\n  … +${result.failures.length - 20} more` : '';
  expect(result.failures,
    `\n${result.failures.length} of ${result.tested} chests failed:\n${shown}${more}\n`).toEqual([]);
});
