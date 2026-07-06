import { test, expect } from '@playwright/test';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// The merge review tool: queue building + merge proposal (pure functions) and
// the web UI end-to-end against a real server on fixture files.

const require = createRequire(import.meta.url);
const review = require('../tools/review-server.cjs');

const mk = (id, name, pos, rules, tags = []) => ({
  id, name, cells: pos.length, rules, pos, tags, img: [],
});

test.describe('review queue + merge proposal', () => {
  test('canonical duplicate groups become dedup items with a proposed merge', () => {
    const entries = [
      mk('a', { ru: 'Сундук у ворот замка' }, [1, 2], 'A:B-', ['ворота']),
      mk('b', { ru: 'Ворота', en: 'Gate chest' }, [1, 2], 'B:A-;A:B-'.replace('B:A-;', ''), ['замок', 'Ворота']),
    ];
    entries[1].rules = 'A:B-';
    const queue = review.buildQueue(entries, { v: 1, overrides: [] }, null);
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('dedup');
    expect(queue[0].candidates).toHaveLength(2);
    const p = queue[0].proposed;
    expect(p.name.ru).toBe('Сундук у ворот замка'); // longest ru wins
    expect(p.name.en).toBe('Gate chest');           // only en available
    expect(p.tags.sort()).toEqual(['ворота', 'замок']); // union, case-insensitive
  });

  test('groups already merged to one entry do not enter the queue', () => {
    const entries = [mk('a', { ru: 'А' }, [1, 2], 'A:B-')];
    const queue = review.buildQueue(entries, { v: 1, overrides: [] }, null);
    expect(queue).toEqual([]);
  });

  test('external proposals (sync) are appended unless their key is already overridden', () => {
    const key1 = 'k1', key2 = 'k2';
    const extra = { items: [
      { type: 'enrich', key: key1, candidates: [], proposed: {} },
      { type: 'conflict', key: key2, candidates: [], proposed: {} },
    ] };
    const decisions = { v: 1, overrides: [{ key: key2, entries: [{}] }] };
    const queue = review.buildQueue([], decisions, extra);
    expect(queue.map(i => i.key)).toEqual([key1]);
  });

  test('applyMergeDecision upserts an override for the key', () => {
    const decisions = { v: 1, overrides: [{ key: 'k', entries: [{ id: 'old' }] }] };
    review.applyMergeDecision(decisions, 'k', [{ id: 'new-merged' }]);
    expect(decisions.overrides).toHaveLength(1);
    expect(decisions.overrides[0].entries[0].id).toBe('new-merged');
    review.applyMergeDecision(decisions, 'k2', [{ id: 'other' }]);
    expect(decisions.overrides).toHaveLength(2);
  });
});

test.describe('review web UI', () => {
  const FX_INI = `"[gate_a]
name=""Сундук у ворот""
cells=2
rules=""A:B-""
start_pos=""1,2""
tags=""ворота"""
"[gate_b]
name=""Ворота замка""
cells=2
rules=""A: B-""
start_pos=""1,2""
tags=""замок"""
`;

  let dir, proc;
  const PORT = 3462;
  const url = (p) => `http://localhost:${PORT}${p}`;

  test.beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-fx-'));
    fs.writeFileSync(path.join(dir, 'chests.ini'), FX_INI);
    fs.writeFileSync(path.join(dir, 'dec.json'), JSON.stringify({ v: 1, overrides: [], additions: [], translations: {} }));
    proc = spawn('node', ['tools/review-server.cjs',
      '--port', String(PORT),
      '--ini', path.join(dir, 'chests.ini'),
      '--decisions', path.join(dir, 'dec.json')]);
    // wait for the server to accept connections
    for (let i = 0; i < 50; i++) {
      try { const r = await fetch(url('/api/queue')); if (r.ok) break; } catch { /* not up yet */ }
      await new Promise(r => setTimeout(r, 100));
    }
  });

  test.afterEach(() => {
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('shows candidates side by side, saves an edited merge, then reports empty', async ({ page }) => {
    await page.goto(url('/'));
    await expect(page.getByTestId('review-progress')).toContainText('1 / 1');
    await expect(page.getByTestId('candidate-0')).toContainText('Сундук у ворот');
    await expect(page.getByTestId('candidate-1')).toContainText('Ворота замка');

    // The proposal is editable — tweak the merged ru name, then accept
    await page.getByTestId('merged-name-ru').fill('Старый лагерь, сундук у ворот замка');
    await page.getByTestId('btn-merge').click();

    await expect(page.getByTestId('review-empty')).toBeVisible();

    const dec = JSON.parse(fs.readFileSync(path.join(dir, 'dec.json'), 'utf8'));
    expect(dec.overrides).toHaveLength(1);
    expect(dec.overrides[0].entries).toHaveLength(1);
    expect(dec.overrides[0].entries[0].name.ru).toBe('Старый лагерь, сундук у ворот замка');
  });

  test('skip advances without writing a decision', async ({ page }) => {
    await page.goto(url('/'));
    await page.getByTestId('btn-skip').click();
    await expect(page.getByTestId('review-empty')).toBeVisible();
    const dec = JSON.parse(fs.readFileSync(path.join(dir, 'dec.json'), 'utf8'));
    expect(dec.overrides).toHaveLength(0);
  });
});
