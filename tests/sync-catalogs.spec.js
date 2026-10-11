import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

// Pure-node tests for tools/sync-catalogs.cjs: orientation handling, the
// cross-variant replay, grouping/verdicts and the additions proposal.

const require = createRequire(import.meta.url);
const sync = require('../tools/sync-catalogs.cjs');
const { canonicalKey } = require('../tools/ini2json.cjs');

const rec = (src, id, pos, rules, extra = {}) => ({ src, id, name: id, place: '', pos, M: sync.rulesToM(rules, pos.length), ...extra });

// Scatty's chest as recorded by religiosa1 (plates numbered bottom-up) and as stored in our DB.
const SCATTY_THEIRS = { pos: [6, 0, 1, 2, 5], rules: 'B:A-,C-,D+;C:A-;D:A+;E:B+' };
const SCATTY_OURS = { pos: [5, 2, 1, 0, 6], rules: 'A:D+;B:E+;C:E-;D:B+,C-,E-' };

test.describe('orientation', () => {
  test('reversing the plate order maps a religiosa1 record onto ours', () => {
    const r = sync.orient(rec('religiosa1', 's', SCATTY_THEIRS.pos, SCATTY_THEIRS.rules), { R: 1, T: 0, X: 0 });
    expect(r.pos).toEqual(SCATTY_OURS.pos);
    expect(canonicalKey(r.pos, sync.mToRules(r.M))).toBe(canonicalKey(SCATTY_OURS.pos, SCATTY_OURS.rules));
  });

  test('transpose stores each link at [affected][moved]', () => {
    const r = sync.orient(rec('x', 'a', [0, 1], 'A:B-'), { R: 0, T: 1, X: 0 });
    expect(sync.mToRules(r.M)).toBe('B:A-');
  });

  test('calibrate recovers the orientation a source was written in', () => {
    const ours = [
      rec('ours', 'a', [5, 2, 1, 0, 6], 'A:D+;B:E+;C:E-;D:B+,C-,E-'),
      rec('ours', 'b', [4, 5, 0, 2, 1, 0], 'A:D-;B:A-,D+,F-;C:F-;D:B+,F+;E:B+,F-;F:D+'),
      rec('ours', 'c', [1, 2, 0, 0, 4], 'A:B-,D+,E-;B:C-,E+;C:A+,E+;D:C-,E-'),
    ];
    // Reversed + transposed + mirrored is its own inverse
    const theirs = ours.map(r => sync.orient(r, { R: 1, T: 1, X: 1 }));
    const best = sync.calibrate(theirs, ours);
    expect(best.orientation).toEqual({ R: 1, T: 1, X: 1 });
    expect(best.exact).toBe(3);
  });
});

test.describe('replay', () => {
  const lock = rec('ours', 'l', [2, 3], 'A:B+');
  test('a solution that centres the lock is ok', () => {
    expect(sync.replay(['1A'], { pos: [2, 3], M: sync.rulesToM('', 2) })).toBe('ok');
  });
  test('reports the press that hits a wall', () => {
    // Pushing plate 1 right drags plate 2 (at hole 6) out of the lock on the first press
    expect(sync.replay(['1D'], { pos: [4, 6], M: sync.rulesToM('A:B-', 2) })).toBe('wall@1');
  });
  test('a solution that leaves a plate off-centre is flagged', () => {
    expect(sync.replay(['1A'], lock)).toBe('off-center');
  });
  test('no solution is reported as unsolvable', () => {
    expect(sync.replay(null, lock)).toBe('unsolvable');
  });
});

test.describe('buildMatrix verdicts', () => {
  const SRC = ['ours', 'ext'];
  const verdictOf = (rows, id) => rows.find(r => r.members.some(m => m.id === id)).verdict;

  test('one shared variant → AGREE; external-only lock → MISSING; ours alone → ONLY-OURS', () => {
    const rows = sync.buildMatrix([
      rec('ours', 'shared', [0, 6, 3], 'A:B+'), rec('ext', 'shared-x', [0, 6, 3], 'A:B+'),
      rec('ext', 'new', [1, 2, 5, 3], 'C:D-'),
      rec('ours', 'lonely', [6, 6, 0, 1, 2], 'E:A+'),
    ], SRC);
    expect(verdictOf(rows, 'shared')).toBe('AGREE');
    expect(verdictOf(rows, 'new')).toBe('MISSING');
    expect(verdictOf(rows, 'lonely')).toBe('ONLY-OURS');
  });

  test('two of our variants, external backs one → KEEP-CONSENSUS with the backed one as v1', () => {
    const rows = sync.buildMatrix([
      rec('ours', 'bad', [5, 2, 1, 0, 6], 'A:D+;B:E+;C:E-;D:B+,E-'),
      rec('ours', 'good', [5, 2, 1, 0, 6], SCATTY_OURS.rules),
      rec('ext', 'theirs', [5, 2, 1, 0, 6], SCATTY_OURS.rules),
    ], SRC);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe('KEEP-CONSENSUS');
    expect(rows[0].members.find(m => m.id === 'good').v).toBe(1);
    // The unsupported variant's solution breaks on the real lock
    expect(rows[0].checks.find(c => c.ours === 2 && c.on === 1).res).toMatch(/^wall@/);
  });

  test('positions recorded in reverse plate order are flagged', () => {
    const rows = sync.buildMatrix([
      rec('ours', 'rev', [3, 5, 3, 6, 0], 'A:B-'), rec('ext', 'fwd', [0, 6, 3, 5, 3], 'A:B-'),
    ], SRC);
    expect(rows[0].reversedPos).toBe(true);
    expect(rows[0].verdict).toBe('OURS-DISPUTED');
  });
});

test.describe('proposeAdditions', () => {
  const rows = sync.buildMatrix([rec('ext', 'X_Chest_01_Lock', [1, 2, 5, 3], 'C:D-', { name: 'Chest 01', place: 'Old Camp' })], ['ours', 'ext']);

  test('turns a MISSING lock into an English-named additions entry', () => {
    const [entry, ...rest] = sync.proposeAdditions(rows, { additions: [], drops: [] }, []);
    expect(rest).toEqual([]);
    expect(entry).toEqual({ id: 'old-camp-chest-01', name: { en: 'Old Camp, Chest 01' }, cells: 4, rules: 'C:D-', pos: [1, 2, 5, 3], tags: ['Old Camp'], img: [] });
  });

  test('is idempotent and never re-adds a dropped lock', () => {
    const first = sync.proposeAdditions(rows, { additions: [], drops: [] }, []);
    expect(sync.proposeAdditions(rows, { additions: first, drops: [] }, [])).toEqual([]);
    expect(sync.proposeAdditions(rows, { additions: [], drops: [canonicalKey([1, 2, 5, 3], 'C:D-')] }, [])).toEqual([]);
  });
});

test.describe('computeEvidence', () => {
  const W = { dsazz: 3, uml: 2 };
  const SRC = ['ours', 'dsazz', 'uml'];
  const keyOf = (pos, rules) => canonicalKey(pos, rules);

  test('scores agreement minus disagreement and points a doubtful variant at the better one', () => {
    const rows = sync.buildMatrix([
      rec('ours', 'bad', [5, 2, 1, 0, 6], 'A:D+;B:E+;C:E-;D:B+,E-'),
      rec('ours', 'good', [5, 2, 1, 0, 6], SCATTY_OURS.rules),
      rec('dsazz', 'OC_Chest_Scatty_Lock', [5, 2, 1, 0, 6], SCATTY_OURS.rules, { name: 'Scatty Chest', place: 'Old Camp' }),
      rec('uml', 'scatty', [5, 2, 1, 0, 6], SCATTY_OURS.rules),
    ], SRC);
    const ev = sync.computeEvidence(rows, W, 'dsazz');
    const good = ev[keyOf(SCATTY_OURS.pos, SCATTY_OURS.rules)];
    const bad = ev[keyOf([5, 2, 1, 0, 6], 'A:D+;B:E+;C:E-;D:B+,E-')];
    expect(good).toEqual({ conf: 5, agree: ['dsazz', 'uml'], disagree: [],
      game: { id: 'OC_Chest_Scatty_Lock', name: 'Scatty Chest', place: 'Old Camp' } });
    expect(bad).toEqual({ conf: -5, agree: [], disagree: ['dsazz', 'uml'], doubt: true, better: keyOf(SCATTY_OURS.pos, SCATTY_OURS.rules) });
  });

  test('a backed variant that one source contradicts is not in doubt', () => {
    const rows = sync.buildMatrix([
      rec('ours', 'ours', [1, 3, 4, 6, 4, 4], 'A:B-,C+;C:A+,E-;D:B-,C-,F+;E:D-,F+;F:A+'),
      rec('dsazz', 'd', [1, 3, 4, 6, 4, 4], 'A:B-,C+;C:A+,E-;D:B-,C-,F+;E:D-,F+;F:A+'),
      rec('uml', 'u', [0, 3, 4, 6, 4, 3], 'A:B-,C+;C:A+,E-;D:B-,C-,F+;E:D-,F+;F:A+'),
    ], SRC);
    const [ev] = Object.values(sync.computeEvidence(rows, W, 'dsazz'));
    expect(ev).toMatchObject({ conf: 1, agree: ['dsazz'], disagree: ['uml'] });
    expect(ev.doubt).toBeUndefined();
  });

  test('an entry no other source knows gets no evidence', () => {
    const rows = sync.buildMatrix([rec('ours', 'lonely', [6, 6, 0, 1, 2], 'E:A+')], SRC);
    expect(sync.computeEvidence(rows, W, 'dsazz')).toEqual({});
  });
});
