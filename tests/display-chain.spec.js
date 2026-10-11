import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// End-to-end display chain on real chests: DB search → drum → SOLVE → step cards
// → 3D scene after every "Step →". Everything is read back from what the user sees
// and checked against an oracle that shares no code with the app (own rule parser,
// own move model, own BFS). The lock structures below were cross-checked against an
// independent community dataset (religiosa1/gothic-lockpick-emulator), so the
// direction/sign conventions are anchored to the game, not to our own code.
const DB = JSON.parse(readFileSync(new URL('../chests.json', import.meta.url), 'utf8')).entries;
const CHESTS = [
  'Old Camp, house above the Arena',
  "Old Camp, Scatty's hut, Fingers' quest",
  'Abandoned hut on the lake near the New Camp entrance',
  'Cavalorn Tower, secont chest (top of tower)',
  'Old Camp, Shadow Hut above the Arena',
];

const CENTER = 3;   // 0-based center of the 7 holes

/** Own parser: "A:B-,C+;…" → coef[src][tgt] ∈ {-1, 0, 1}. */
function matrix(rules, n) {
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const tok of rules.split(';')) {
    if (!tok.includes(':')) continue;
    const [src, body] = tok.split(':');
    for (const p of body.split(',')) if (p) m[src.charCodeAt(0) - 65][p.charCodeAt(0) - 65] = p[1] === '+' ? 1 : -1;
  }
  return m;
}

/** Own move model: A (left) = +1 on the 0-based hole index; all-or-nothing blocking. */
function move(pos, m, plate, dir) {
  const out = pos.map((v, j) => v + (j === plate ? dir : dir * m[plate][j]));
  return out.every(v => v >= 0 && v <= 6) ? out : null;
}

/** Minimal number of keypresses (plain BFS). */
function shortest(start, m) {
  const goal = start.map(() => CENTER).join();
  const seen = new Map([[start.join(), 0]]);
  const queue = [start];
  for (let h = 0; h < queue.length; h++) {
    const d = seen.get(queue[h].join());
    if (queue[h].join() === goal) return d;
    for (let i = 0; i < start.length; i++) for (const dir of [1, -1]) {
      const nx = move(queue[h], m, i, dir);
      if (nx && !seen.has(nx.join())) { seen.set(nx.join(), d + 1); queue.push(nx); }
    }
  }
  return null;
}

/** 0-based hole index each plate shows in the 3D solve scene, plus its pin state. */
async function scenePositions(page, n) {
  const step = await page.evaluate(() => holeStep(7));
  const out = [];
  for (let id = 1; id <= n; id++) {
    const style = await page.getByTestId(`scene-solve-inner-plate-${id}`).getAttribute('style');
    const dx = Number(style.match(/translateX\((-?[\d.]+)px\)/)[1]);
    const raised = /\braised\b/.test(await page.getByTestId(`scene-solve-inner-pin-${id}`).getAttribute('class'));
    // offsetX = (center − pos) · step → a plate slid left (negative X) has a higher index
    out.push({ pos: Math.round(CENTER - dx / step), raised });
  }
  return out;
}

test.beforeEach(async ({ page }) => { await page.goto('/'); });

for (const name of CHESTS) {
  test(`display chain matches the oracle: ${name}`, async ({ page }) => {
    test.setTimeout(60000);
    const entry = DB.find(e => e.name.en === name);
    expect(entry, `chest "${name}" missing from chests.json`).toBeTruthy();
    const n = entry.cells;
    const m = matrix(entry.rules, n);

    // DB search → apply, the way a user loads a chest
    await page.getByTestId('btn-search-db').click();
    await page.getByTestId('search-input').fill(entry.name.ru);
    await expect(page.getByTestId('search-result-0-name')).toHaveText(entry.name.ru);
    await page.getByTestId('search-result-0').click();
    await expect(page.getByTestId('search-dialog')).toBeHidden();

    // Drum shows 1-based holes
    await expect(page.getByTestId('val-plates')).toHaveText(String(n));
    for (let i = 0; i < n; i++) await expect(page.getByTestId(`pos-input-${i + 1}`)).toHaveValue(String(entry.pos[i] + 1));

    await page.getByTestId('btn-start').click();
    await expect(page.getByTestId('stage-solve')).toBeVisible({ timeout: 15000 });

    // Step cards as rendered
    const cards = [];
    for (let k = 1; ; k++) {
      const card = page.getByTestId(`step-${k}`);
      if (await card.count() === 0) break;
      const plate = Number((await card.getByTestId('step-plate').textContent()).match(/\d+/)[0]);
      const dirEl = card.getByTestId('step-dir');
      const dir = await dirEl.getAttribute('data-dir');
      const count = Number((await dirEl.textContent()).match(/×(\d+)/)[1]);
      const notation = (await card.getByTestId('step-notation').textContent()).trim();
      // Card parts and the notation badge describe the same move
      expect(notation).toBe(`${plate}${dir === 'left' ? 'A' : 'D'}${count > 1 ? count : ''}`);
      cards.push({ plate, dir, count });
    }
    expect(cards.length).toBeGreaterThan(0);

    // The one-line solution string lists the same moves in the same order
    const line = (await page.getByTestId('solution-string').textContent()).match(/\d+[AD]\d*/g);
    expect(line).toEqual(cards.map(c => `${c.plate}${c.dir === 'left' ? 'A' : 'D'}${c.count > 1 ? c.count : ''}`));

    // Start of playback shows the chest's starting holes
    expect((await scenePositions(page, n)).map(s => s.pos)).toEqual(entry.pos);

    // Play the cards step by step; the scene must track the oracle exactly
    let pos = entry.pos.slice();
    let presses = 0;
    for (const [k, c] of cards.entries()) {
      const before = await scenePositions(page, n);
      for (let r = 0; r < c.count; r++) {
        pos = move(pos, m, c.plate - 1, c.dir === 'left' ? 1 : -1);
        expect(pos, `card ${k + 1} (${c.plate} ${c.dir} ×${c.count}) hits a wall at press ${r + 1}`).not.toBeNull();
        presses++;
      }
      await page.getByTestId('btn-step').click();
      const shown = await scenePositions(page, n);
      expect(shown.map(s => s.pos), `scene after card ${k + 1}`).toEqual(pos);
      expect(shown.map(s => s.raised), `pins after card ${k + 1}`).toEqual(pos.map(p => p === CENTER));
      // "Left" really moves the moved plate left on screen (to a higher hole index)
      const shift = shown[c.plate - 1].pos - before[c.plate - 1].pos;
      expect(Math.sign(shift)).toBe(c.dir === 'left' ? 1 : -1);
    }

    expect(pos.every(p => p === CENTER)).toBe(true);
    expect(presses).toBe(shortest(entry.pos.slice(), m));
    await expect(page.getByTestId('btn-step')).toBeDisabled();
  });
}
