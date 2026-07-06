#!/usr/bin/env node
'use strict';

// Sync against unlockmyloot.com's open catalog (github.com/1h8s/unlockmyloot):
// fetch their ru+en lock pages, decode the ?lock= v2 codes, classify each lock
// against our DB and emit review proposals — nothing is imported blindly.
//
//   node tools/sync-uml.cjs [--cache <dir>]   → tools/review-queue.json
//
// Classification:
//   EXACT    same canonical key → "enrich" proposal (their desc fills ours;
//            our names win by default — everything editable in the review UI)
//   CONFLICT same rules + plate count, different positions → human verdict
//   NEW      unknown canonical key → "add" proposal
//
// Format note: only the numeric lock code and page texts are read; no code is
// taken from their AGPL repo.

const fs = require('fs');
const path = require('path');
const { canonicalKey, rulesEdges } = require('./ini2json.cjs');
const { proposeMerge } = require('./review-server.cjs');

// ── v2 lock-code decoder ──────────────────────────────────────────────────────
// Bitstream in a base64url alphabet: 3b plateCount−3, 1b display-flip,
// 3b per pin (0-based), 2b per ordered link pair (0 none / 1 same / 2 opposite).

const CODE_ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function decodeLockCode(code) {
  const bits = [];
  for (const ch of code) {
    const v = CODE_ABC.indexOf(ch);
    if (v < 0) throw new Error(`bad lock code char: ${ch}`);
    for (let b = 5; b >= 0; b--) bits.push((v >> b) & 1);
  }
  let at = 0;
  const read = (w) => { let v = 0; for (let b = 0; b < w; b++) v = (v << 1) | bits[at++]; return v; };

  const n = read(3) + 3;
  read(1); // display orientation flag — irrelevant to lock physics
  const pos = [];
  for (let i = 0; i < n; i++) pos.push(read(3)); // 0-based, same as our DB

  const byFrom = new Map();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const t = read(2);
      if (!t) continue;
      const from = String.fromCharCode(65 + i);
      const tok = String.fromCharCode(65 + j) + (t === 1 ? '+' : '-');
      if (!byFrom.has(from)) byFrom.set(from, []);
      byFrom.get(from).push(tok);
    }
  }
  const rules = [...byFrom.keys()].sort()
    .map(f => `${f}:${byFrom.get(f).join(',')}`)
    .join(';');

  return { pos, rules };
}

// ── page parser ───────────────────────────────────────────────────────────────

function parseLockPage(html) {
  const code = (html.match(/lock=([A-Za-z0-9_-]{5,24})/) || [])[1] || null;
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || null;
  // Breadcrumb: the last <span> inside <nav class="crumb"> is the short name
  const crumb = (html.match(/<nav class="crumb"[^>]*>([\s\S]*?)<\/nav>/) || [])[1] || '';
  const spans = [...crumb.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map(m => m[1].trim());
  const name = spans.filter(s => s && s !== '/').pop() || null;
  return { name, desc, code };
}

// ── classification ────────────────────────────────────────────────────────────

/** Their record: { slug, pos, rules, name: {ru,en}, desc: {ru,en} } */
function classify(theirRecords, ourEntries) {
  const ourByKey = new Map();
  const ourByEdges = new Map(); // rules+plateCount → groups, for conflict detection
  for (const e of ourEntries) {
    const key = canonicalKey(e.pos, e.rules);
    if (!ourByKey.has(key)) ourByKey.set(key, []);
    ourByKey.get(key).push(e);
    const ek = [...rulesEdges(e.rules)].sort().join(';') + '|' + e.pos.length;
    if (!ourByEdges.has(ek)) ourByEdges.set(ek, []);
    ourByEdges.get(ek).push(e);
  }

  const fill = (target, add) => {
    const out = { ...target };
    for (const [k, v] of Object.entries(add || {})) if (!out[k] && v) out[k] = v;
    return out;
  };

  const items = [];
  const stats = { exact: 0, conflict: 0, added: 0 };

  for (const t of theirRecords) {
    const theirEntry = {
      id: `uml:${t.slug}`, name: t.name, desc: t.desc,
      cells: t.pos.length, rules: t.rules, pos: t.pos, tags: [], img: [],
    };
    const key = canonicalKey(t.pos, t.rules);
    const ourGroup = ourByKey.get(key);

    if (ourGroup) {
      stats.exact++;
      const base = proposeMerge(ourGroup); // our names/tags win by default
      const proposed = { ...base, desc: fill(base.desc || {}, t.desc) };
      items.push({ type: 'enrich', key, candidates: [...ourGroup, theirEntry], proposed,
                   note: `unlockmyloot: ${t.slug}` });
      continue;
    }

    const ek = [...rulesEdges(t.rules)].sort().join(';') + '|' + t.pos.length;
    const near = ourByEdges.get(ek);
    if (near) {
      stats.conflict++;
      const ourKey = canonicalKey(near[0].pos, near[0].rules);
      items.push({
        type: 'conflict', key: ourKey, candidates: [...near, theirEntry],
        proposed: proposeMerge(near),
        note: `positions differ: ours ${near.map(e => e.pos.join(',')).join(' / ')} vs theirs ${t.pos.join(',')} (${t.slug}) — verify in game`,
      });
      continue;
    }

    stats.added++;
    items.push({ type: 'add', key, candidates: [theirEntry],
                 proposed: { ...theirEntry, id: t.slug }, note: `unlockmyloot: new lock ${t.slug}` });
  }

  return { items, stats };
}

module.exports = { decodeLockCode, parseLockPage, classify, CODE_ABC };

// ── CLI ───────────────────────────────────────────────────────────────────────

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function main() {
  const cacheIdx = process.argv.indexOf('--cache');
  const cacheDir = cacheIdx > 0 ? process.argv[cacheIdx + 1] : null;
  const RAW = 'https://raw.githubusercontent.com/1h8s/unlockmyloot/HEAD';

  let slugs;
  if (cacheDir) {
    slugs = fs.readdirSync(cacheDir).filter(f => f.endsWith('.ru.html')).map(f => f.replace('.ru.html', ''));
  } else {
    const tree = JSON.parse(await fetchText('https://api.github.com/repos/1h8s/unlockmyloot/git/trees/HEAD?recursive=1'));
    slugs = tree.tree.filter(x => /^locks\/[^/]+\/index\.html$/.test(x.path)).map(x => x.path.split('/')[1]);
  }

  const records = [];
  for (const slug of slugs) {
    const load = async (lang) => {
      if (cacheDir) {
        const p = path.join(cacheDir, `${slug}.${lang}.html`);
        return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
      }
      const prefix = lang === 'ru' ? '' : 'en/';
      return fetchText(`${RAW}/${prefix}locks/${slug}/index.html`).catch(() => null);
    };
    const ru = parseLockPage((await load('ru')) || '');
    const en = parseLockPage((await load('en')) || '');
    const code = ru.code || en.code;
    if (!code) { process.stderr.write(`SKIP ${slug}: no lock code\n`); continue; }
    const { pos, rules } = decodeLockCode(code);
    records.push({
      slug, pos, rules,
      name: { ...(ru.name && { ru: ru.name }), ...(en.name && { en: en.name }) },
      desc: { ...(ru.desc && { ru: ru.desc }), ...(en.desc && { en: en.desc }) },
    });
  }

  const our = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'chests.json'), 'utf8')).entries;
  const { items, stats } = classify(records, our);
  const out = path.join(__dirname, 'review-queue.json');
  fs.writeFileSync(out, JSON.stringify({ v: 1, source: 'unlockmyloot', updated: new Date().toISOString(), items }, null, 2), 'utf8');
  process.stderr.write(
    `Locks: ${records.length}  exact(enrich): ${stats.exact}  conflicts: ${stats.conflict}  new: ${stats.added}\n` +
    `Queue: ${out} — review with: npm run review:db\n`
  );
}

if (require.main === module) {
  main().catch(e => { process.stderr.write(String(e.stack || e) + '\n'); process.exit(1); });
}
