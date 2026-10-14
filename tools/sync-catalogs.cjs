#!/usr/bin/env node
'use strict';

// Cross-check our chest DB against external lock catalogs and build a comparison
// matrix: one row per physical lock, one column per source, every disagreement
// checked by replaying our solution on the other variant.
//
//   node tools/sync-catalogs.cjs                 fetch sources, compare, write reports
//   node tools/sync-catalogs.cjs --offline       reuse the cache in tools/catalogs/
//   node tools/sync-catalogs.cjs --add-missing   also append locks we lack to
//                                                db-decisions.json `additions`
//   node tools/sync-catalogs.cjs --write-evidence  also (re)write db-decisions.json
//                                                `evidence` (agreement score, doubt
//                                                flag, better variant, game metadata)
//
// Output (tools/catalogs/, gitignored): matrix.json, report.txt, lock-matrix.html.
// Nothing is dropped automatically — `drops` stay a human decision (see report).
//
// Each source declares its orientation relative to our DB (R = reversed plate
// order, T = matrix stored target→source, X = mirrored positions). The run
// re-derives the best orientation from the data and refuses to continue if it
// disagrees with the declaration — a changed upstream format must not silently
// produce a mirrored matrix.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const https = require('https');
const { execFileSync } = require('child_process');
const { canonicalKey } = require('./ini2json.cjs');
const { decodeLockCode } = require('./sync-uml.cjs');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(__dirname, 'catalogs');
const N_HOLES = 7;
const CENTER = 3;

// ── lock model ────────────────────────────────────────────────────────────────
// A record is { src, id, name, place, pos: 0-based holes, M: coef[moved][affected] }.

const L = i => String.fromCharCode(65 + i);
const emptyM = n => Array.from({ length: n }, () => new Array(n).fill(0));

function rulesToM(rules, n) {
  const m = emptyM(n);
  for (const tok of rules.split(';')) {
    if (!tok.includes(':')) continue;
    const [src, body] = tok.split(':');
    for (const p of body.split(',')) if (p) m[src.charCodeAt(0) - 65][p.charCodeAt(0) - 65] = p[1] === '+' ? 1 : -1;
  }
  return m;
}

function mToRules(M) {
  return M.map((row, i) => {
    const t = row.flatMap((c, j) => c ? [L(j) + (c > 0 ? '+' : '-')] : []);
    return t.length ? `${L(i)}:${t.join(',')}` : null;
  }).filter(Boolean).join(';');
}

const recKey = r => canonicalKey(r.pos, mToRules(r.M));
const edges = M => new Set(M.flatMap((row, i) => row.flatMap((c, j) => c ? [`${i}>${j}${c > 0 ? '+' : '-'}`] : [])));

/** Re-express a record under orientation {R, T, X}. */
function orient(r, { R, T, X }) {
  const n = r.pos.length;
  const idx = i => R ? n - 1 - i : i;
  const pos = new Array(n);
  const M = emptyM(n);
  for (let i = 0; i < n; i++) pos[idx(i)] = X ? N_HOLES - 1 - r.pos[i] : r.pos[i];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (!r.M[i][j]) continue;
    if (T) M[idx(j)][idx(i)] = r.M[i][j]; else M[idx(i)][idx(j)] = r.M[i][j];
  }
  return { ...r, pos, M };
}

/** Find the orientation under which a source agrees with our DB the most. */
function calibrate(records, ours) {
  const ourKeys = new Set(ours.map(recKey));
  const ourEdges = new Set(ours.map(r => r.pos.length + ':' + [...edges(r.M)].sort().join(';')));
  let best = null;
  for (const R of [0, 1]) for (const T of [0, 1]) for (const X of [0, 1]) {
    const tr = records.map(r => orient(r, { R, T, X }));
    const exact = tr.filter(r => ourKeys.has(recKey(r))).length;
    const sameLinks = tr.filter(r => ourEdges.has(r.pos.length + ':' + [...edges(r.M)].sort().join(';'))).length;
    const score = exact * 2 + sameLinks;
    if (!best || score > best.score) best = { score, exact, sameLinks, orientation: { R, T, X } };
  }
  return best;
}

// ── sources ───────────────────────────────────────────────────────────────────

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'gothic-lockpick-sync' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(get(res.headers.location));
      if (res.statusCode !== 200) return reject(new Error(`${url}: HTTP ${res.statusCode}`));
      let body = ''; res.setEncoding('utf8');
      res.on('data', c => { body += c; }); res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function gitMirror(url, dir) {
  if (fs.existsSync(path.join(dir, '.git'))) execFileSync('git', ['-C', dir, 'pull', '-q', '--ff-only'], { stdio: 'inherit' });
  else execFileSync('git', ['clone', '-q', '--depth', '1', url, dir], { stdio: 'inherit' });
}

const SOURCES = [
  {
    id: 'dsazz',
    title: 'gothic-remake-lockbreaker (dsazz)',
    url: 'https://github.com/dsazz/gothic-remake-lockbreaker',
    // positions −3..3; matrix[i][j] = how plate i reacts when plate j is turned
    orientation: { R: 0, T: 1, X: 0 },
    weight: 3,   // in-game asset ids suggest extracted game data — strong, but unproven
    gameMeta: true,   // its id/name/place become the entry's `game` metadata
    async fetch(dir) { fs.writeFileSync(path.join(dir, 'dsazz.json'), await get('https://gothiclockbreaker.com/assets/catalog/locks.json')); },
    load(dir) {
      return JSON.parse(fs.readFileSync(path.join(dir, 'dsazz.json'), 'utf8')).entries.map(e => ({
        id: e.id, name: e.name, place: e.place, pos: e.positions.map(p => p + CENTER), M: e.matrix.map(r => r.slice()),
      }));
    },
  },
  {
    id: 'uml',
    title: 'unlockmyloot.com',
    url: 'https://github.com/1h8s/unlockmyloot',
    orientation: { R: 0, T: 0, X: 0 },   // decodeLockCode already speaks our convention
    weight: 2,
    async fetch(dir) { gitMirror('https://github.com/1h8s/unlockmyloot.git', path.join(dir, 'uml')); },
    load(dir) {
      const base = path.join(dir, 'uml', 'locks');
      return fs.readdirSync(base).flatMap(slug => {
        const file = path.join(base, slug, 'index.html');
        if (!fs.existsSync(file)) return [];
        const html = fs.readFileSync(file, 'utf8');
        const code = (html.match(/lock=([A-Za-z0-9_-]{5,24})/) || [])[1];
        if (!code) return [];
        const { pos, rules } = decodeLockCode(code);
        const name = ((html.match(/<title>([^<]*)/) || [])[1] || slug).split(' — ')[0].trim();
        return [{ id: slug, name, place: '', pos, M: rulesToM(rules, pos.length) }];
      });
    },
  },
  {
    id: 'religiosa1',
    title: 'gothic-lockpick-emulator (religiosa1)',
    url: 'https://github.com/religiosa1/gothic-lockpick-emulator',
    // plates numbered bottom-up; dependencies[moved] = [[affected, coef]]
    orientation: { R: 1, T: 0, X: 0 },
    weight: 2,   // presumably recorded in game by hand
    async fetch(dir) { gitMirror('https://github.com/religiosa1/gothic-lockpick-emulator.git', path.join(dir, 'religiosa1')); },
    load(dir) {
      const base = path.join(dir, 'religiosa1', 'locks');
      return fs.readdirSync(base).filter(f => f.endsWith('.json')).map(f => {
        const j = JSON.parse(fs.readFileSync(path.join(base, f), 'utf8')).field;
        const n = j.tumblerPositions.length;
        const M = emptyM(n);
        for (const [k, deps] of Object.entries(j.dependencies)) if (+k < n) for (const [t, c] of deps) M[+k][t] = c;
        return { id: f.replace(/\.json$/, ''), name: f.replace(/\.json$/, ''), place: '', pos: j.tumblerPositions.slice(), M };
      });
    },
  },
];
// Checked and rejected (2026-10): gothicremakelockpicking.com presets and the
// tools.nkbgaming.com catalog — no record matches any other source under any
// orientation, and nkbgaming lists 3-plate locks, which the game doesn't have.

// ── grouping & verdicts ───────────────────────────────────────────────────────

let solverCtx = null;
function solver() {
  if (!solverCtx) {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    solverCtx = {}; vm.createContext(solverCtx);
    vm.runInContext(html.match(/<script id="solver-src">([\s\S]*?)<\/script>/)[1], solverCtx);
  }
  return solverCtx;
}

const toPlates = r => r.pos.map((p, i) => ({ id: i + 1, positions: N_HOLES, currentPos: p + 1,
  deps: r.M[i].flatMap((c, j) => c ? [{ targetId: j + 1, direction: c > 0 ? 'same' : 'opposite', steps: 1 }] : []) }));

/** Replay a compressed solution on another variant: 'ok' | 'wall@<press>' | 'off-center' | 'unsolvable'. */
function replay(solution, on) {
  if (!solution) return 'unsolvable';
  let st = on.pos.slice(); let press = 0;
  for (const step of solution) {
    const m = step.match(/^(\d+)([AD])(\d*)$/);
    for (let c = 0; c < (m[3] ? +m[3] : 1); c++) {
      press++;
      const i = +m[1] - 1, d = m[2] === 'A' ? 1 : -1;
      const nx = st.map((v, j) => v + (j === i ? d : d * on.M[i][j]));
      if (nx.some(v => v < 0 || v >= N_HOLES)) return `wall@${press}`;
      st = nx;
    }
  }
  return st.every(v => v === CENTER) ? 'ok' : 'off-center';
}

function symdiff(a, b) { let d = 0; for (const x of a) if (!b.has(x)) d++; for (const x of b) if (!a.has(x)) d++; return d; }

/**
 * Group records into physical locks (same key; or same links with other
 * positions; or same positions with ≤ maxLinkDiff link differences), then
 * classify each group. `srcOrder` lists source ids, 'ours' first.
 */
function buildMatrix(records, srcOrder, { maxLinkDiff = 3, solve } = {}) {
  const recs = records.map((r, i) => ({ ...r, i, n: r.pos.length, k: recKey(r), E: edges(r.M) }));
  const parent = recs.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let a = 0; a < recs.length; a++) for (let b = a + 1; b < recs.length; b++) {
    const A = recs[a], B = recs[b];
    if (A.n !== B.n) continue;
    const d = symdiff(A.E, B.E);
    if (A.k === B.k || d === 0 || (A.pos.join() === B.pos.join() && d <= maxLinkDiff)) parent[find(a)] = find(b);
  }
  const groups = new Map();
  for (const r of recs) { const g = find(r.i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }

  const solveCached = new Map();
  const solveFn = solve || (r => solver().bfsSolveGrouped(toPlates(r)).solution);
  const solutionOf = r => { if (!solveCached.has(r.k)) solveCached.set(r.k, solveFn(r)); return solveCached.get(r.k); };
  const ext = srcOrder.filter(s => s !== 'ours');

  const rows = [];
  for (const g of groups.values()) {
    // Variants ordered by how many sources back them (v1 = best supported)
    let variants = [...new Map(g.map(r => [r.k, r])).values()].map(v => ({
      k: v.k, pos: v.pos, M: v.M, rules: mToRules(v.M), srcs: srcOrder.filter(s => g.some(r => r.src === s && r.k === v.k)),
    }));
    variants = variants.map((v, i) => ({ v, i })).sort((a, b) => b.v.srcs.length - a.v.srcs.length || a.i - b.i).map(x => x.v);
    const vIndex = k => variants.findIndex(v => v.k === k) + 1;
    const cells = Object.fromEntries(srcOrder.map(s => [s, [...new Set(g.filter(r => r.src === s).map(r => vIndex(r.k)))].sort()]));

    const checks = [];
    for (const ov of variants.filter(v => v.srcs.includes('ours'))) {
      for (const tv of variants) if (tv !== ov) checks.push({ ours: vIndex(ov.k), on: vIndex(tv.k), res: replay(solutionOf(ov), tv) });
    }

    const ourVariants = variants.filter(v => v.srcs.includes('ours'));
    const supported = ourVariants.filter(v => v.srcs.some(s => ext.includes(s)));
    const extOnly = variants.filter(v => !v.srcs.includes('ours'));
    let verdict;
    if (!ourVariants.length) verdict = 'MISSING';
    else if (variants.length === 1) verdict = variants[0].srcs.length > 1 ? 'AGREE' : 'ONLY-OURS';
    else if (checks.every(c => c.res === 'ok')) verdict = 'DEDUP-BENIGN';
    else if (!supported.length) verdict = 'OURS-DISPUTED';
    else if (supported.length === 1 && !extOnly.length) verdict = 'KEEP-CONSENSUS';
    else verdict = 'SOURCES-DISAGREE';

    const rev = s => s.slice().reverse().join();
    const reversedPos = variants.some(a => variants.some(b => a !== b && a.pos.join() !== b.pos.join() && a.pos.join() === rev(b.pos)));
    const lead = g.find(r => r.src === 'ours') || g[0];
    rows.push({
      name: lead.name, place: lead.place || '', plates: g[0].n, verdict, reversedPos, cells, checks,
      variants: variants.map(v => ({ key: v.k, pos: v.pos.join(''), rules: v.rules, srcs: v.srcs })),
      members: g.map(r => ({ src: r.src, id: r.id, name: r.name, place: r.place || '', v: vIndex(r.k), pos: r.pos, rules: mToRules(r.M) })),
    });
  }
  return rows;
}

// ── decisions: append missing locks ───────────────────────────────────────────

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);

/**
 * Turn MISSING rows into `additions` entries (English name only — the other
 * languages go through tools/translate-gaps.cjs). Idempotent: a lock whose
 * canonical key is already built, added or dropped is skipped.
 */
function proposeAdditions(rows, decisions, builtEntries) {
  const known = new Set([
    ...builtEntries.map(e => canonicalKey(e.pos, e.rules)),
    ...(decisions.additions || []).map(e => canonicalKey(e.pos, e.rules)),
    ...(decisions.drops || []),
  ]);
  const ids = new Set([...builtEntries.map(e => e.id), ...(decisions.additions || []).map(e => e.id)]);
  const out = [];
  for (const row of rows.filter(r => r.verdict === 'MISSING')) {
    const m = row.members.find(x => x.v === 1);
    const key = canonicalKey(m.pos, m.rules);
    if (known.has(key)) continue;
    const name = m.place ? `${m.place}, ${m.name}` : m.name;
    let id = slug(name) || 'lock-' + m.pos.join(''); let n = 2;
    while (ids.has(id)) id = `${slug(name)}-${n++}`;
    ids.add(id); known.add(key);
    out.push({ id, name: { en: name }, cells: m.pos.length, rules: m.rules, pos: m.pos.slice(), tags: m.place ? [m.place] : [], img: [] });
  }
  return out;
}

// ── evidence: how well each of our entries agrees with the other sources ──────

/**
 * Per canonical key of OUR variants: which sources hold the same variant
 * (agree), which hold a different variant of the same lock (disagree), and a
 * weighted score `conf` = Σ weight(agree) − Σ weight(disagree). `doubt` marks an
 * entry the sources speak against (some disagreement and conf ≤ 0); `better` is
 * the key of our own variant of the same lock with a higher conf, if any.
 * `game` carries the record of `metaSource` (asset id, English name, place).
 * Entries without any external record get no evidence at all.
 */
function computeEvidence(rows, weights, metaSource) {
  const out = {};
  for (const row of rows) {
    const ext = Object.keys(row.cells).filter(s => s !== 'ours' && row.cells[s].length);
    if (!ext.length) continue;
    const ours = row.variants.filter(v => v.srcs.includes('ours')).map(v => {
      const agree = v.srcs.filter(s => s !== 'ours');
      const disagree = ext.filter(s => !agree.includes(s));
      const conf = agree.reduce((a, s) => a + weights[s], 0) - disagree.reduce((a, s) => a + weights[s], 0);
      const g = v.srcs.includes(metaSource)
        ? row.members.find(m => m.src === metaSource && canonicalKey(m.pos, m.rules) === v.key) : null;
      return { key: v.key, agree, disagree, conf, game: g ? { id: g.id, name: g.name, place: g.place } : null };
    });
    for (const e of ours) {
      const best = ours.filter(o => o.conf > e.conf).sort((a, b) => b.conf - a.conf)[0];
      const ev = { conf: e.conf, agree: e.agree, disagree: e.disagree };
      if (e.disagree.length && e.conf <= 0) ev.doubt = true;
      if (best) ev.better = best.key;
      if (e.game) ev.game = e.game;
      out[e.key] = ev;
    }
  }
  return out;
}

// ── reports ───────────────────────────────────────────────────────────────────

const VERDICT_ORDER = ['OURS-DISPUTED', 'SOURCES-DISAGREE', 'KEEP-CONSENSUS', 'DEDUP-BENIGN', 'MISSING', 'ONLY-OURS', 'AGREE'];

function textReport(rows, calib, oursCount) {
  const lines = [`Our DB: ${oursCount} entries`, ''];
  for (const c of calib) lines.push(`${c.id.padEnd(11)} ${String(c.count).padStart(4)} records  orientation R${c.orientation.R} T${c.orientation.T} X${c.orientation.X}  exact ${c.exact}, same links ${c.sameLinks}`);
  const cnt = {}; for (const r of rows) cnt[r.verdict] = (cnt[r.verdict] || 0) + 1;
  lines.push('', `${rows.length} locks: ` + VERDICT_ORDER.filter(v => cnt[v]).map(v => `${v} ${cnt[v]}`).join(', '));
  for (const v of VERDICT_ORDER.filter(v => !['AGREE', 'MISSING', 'ONLY-OURS'].includes(v))) {
    for (const r of rows.filter(x => x.verdict === v)) {
      lines.push('', `[${v}] ${r.name} (${r.plates})${r.reversedPos ? '  ⇄ reversed positions' : ''}`);
      r.variants.forEach((x, i) => lines.push(`  v${i + 1} ${x.pos} ${x.rules}  ← ${x.srcs.join(',')}`));
      if (r.checks.length) lines.push('  ' + r.checks.map(c => `v${c.ours}→v${c.on} ${c.res}`).join('; '));
      if (v === 'KEEP-CONSENSUS') {
        const drop = r.members.filter(m => m.src === 'ours' && m.v !== 1);
        lines.push('  drop candidates: ' + drop.map(m => `${m.id} [${canonicalKey(m.pos, m.rules)}]`).join(', '));
      }
    }
  }
  return lines.join('\n') + '\n';
}

function htmlReport(rows, oursCount) {
  const tpl = fs.readFileSync(path.join(__dirname, 'catalog-matrix.html'), 'utf8');
  const sorted = rows.slice().sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || a.name.localeCompare(b.name));
  const data = sorted.map(r => ({ a: r.verdict, n: r.name, p: r.plates, rev: r.reversedPos, c: r.cells,
    v: r.variants.map(v => [v.pos, v.rules, v.srcs]), x: r.checks.map(c => [c.ours, c.on, c.res]),
    m: r.members.map(m => [m.src, m.id, m.name, m.v]) }));
  // function replacers: the JSON may contain `$&`-like sequences
  return tpl.replace('/*OURS_COUNT*/0', () => String(oursCount))
    .replace('/*DATA*/[]', () => JSON.stringify(data).replace(/</g, '\\u003c'));
}

// ── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--add-missing') && args.has('--write-evidence')) {
    // Evidence scores what chests.json holds; new additions only get there after a build.
    throw new Error('run --add-missing, then npm run build:db (and translate), then --write-evidence');
  }
  fs.mkdirSync(CACHE, { recursive: true });
  if (!args.has('--offline')) for (const s of SOURCES) { process.stderr.write(`fetch ${s.id}…\n`); await s.fetch(CACHE); }

  const built = JSON.parse(fs.readFileSync(path.join(ROOT, 'chests.json'), 'utf8')).entries;
  const ours = built.map(e => ({ src: 'ours', id: e.id, name: e.name.en || e.name.ru, place: '', pos: e.pos, M: rulesToM(e.rules, e.cells) }));

  const records = [...ours]; const calib = [];
  for (const s of SOURCES) {
    const raw = s.load(CACHE);
    const best = calibrate(raw, ours);
    const o = best.orientation, d = s.orientation;
    if (o.R !== d.R || o.T !== d.T || o.X !== d.X) {
      throw new Error(`${s.id}: data fits orientation R${o.R} T${o.T} X${o.X}, declared R${d.R} T${d.T} X${d.X} — upstream format changed? Re-check before trusting the matrix.`);
    }
    calib.push({ id: s.id, count: raw.length, ...best });
    records.push(...raw.map(r => ({ ...orient(r, d), src: s.id })));
  }

  const rows = buildMatrix(records, ['ours', ...SOURCES.map(s => s.id)]);
  fs.writeFileSync(path.join(CACHE, 'matrix.json'), JSON.stringify(rows, null, 1));
  const report = textReport(rows, calib, built.length);
  fs.writeFileSync(path.join(CACHE, 'report.txt'), report);
  fs.writeFileSync(path.join(CACHE, 'lock-matrix.html'), htmlReport(rows, built.length));
  process.stdout.write(report.split('\n\n').slice(0, 3).join('\n\n') + '\n\nFull report: tools/catalogs/report.txt, matrix: tools/catalogs/lock-matrix.html\n');

  if (args.has('--add-missing') || args.has('--write-evidence')) {
    const decFile = path.join(__dirname, 'db-decisions.json');
    const decisions = JSON.parse(fs.readFileSync(decFile, 'utf8'));
    if (args.has('--add-missing')) {
      const add = proposeAdditions(rows, decisions, built);
      decisions.additions = [...(decisions.additions || []), ...add];
      process.stdout.write(`\nadded ${add.length} locks to additions — build, translate the names (tools/translate-gaps.cjs), then re-run with --write-evidence\n`);
    }
    if (args.has('--write-evidence')) {
      // Derived data: replaced as a whole on every run, never merged
      decisions.evidence = computeEvidence(rows, Object.fromEntries(SOURCES.map(s => [s.id, s.weight])),
        (SOURCES.find(s => s.gameMeta) || {}).id);
      const ev = Object.values(decisions.evidence);
      process.stdout.write(`\nevidence for ${ev.length} keys (${ev.filter(e => e.doubt).length} in doubt) — now: npm run build:db\n`);
    }
    fs.writeFileSync(decFile, JSON.stringify(decisions, null, 2), 'utf8');   // same format as the other decision writers
  }
}

if (require.main === module) main().catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });

module.exports = { SOURCES, rulesToM, mToRules, orient, calibrate, replay, buildMatrix, proposeAdditions, computeEvidence };
