#!/usr/bin/env node
'use strict';

// Merge review tool: a tiny no-deps web server. The page shows the candidates
// of one queue item side by side plus an editable merged variant; accepting
// writes an override into tools/db-decisions.json (the rerere layer).
//
//   npm run review:db     → http://localhost:3210
//
// Queue sources:
//   - canonical duplicate groups from the ini+decisions build (type "dedup")
//   - external proposals from sync tools (tools/review-queue.json):
//     enrichment / position conflicts / additions.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { buildEntries, canonicalKey } = require('./ini2json.cjs');

// ── merge proposal ────────────────────────────────────────────────────────────

function score(e) {
  return Object.values(e.name || {}).join('').length + (e.tags || []).length * 10;
}

/** Union-merge a duplicate group into one proposed entry. */
function proposeMerge(candidates) {
  const best = candidates.reduce((a, b) => (score(b) > score(a) ? b : a));

  const mergeLangs = (field) => {
    const out = {};
    for (const c of candidates) {
      for (const [lang, text] of Object.entries(c[field] || {})) {
        if (!out[lang] || text.length > out[lang].length) out[lang] = text; // longest wins
      }
    }
    return out;
  };

  const tags = [];
  const seenTag = new Set();
  for (const c of candidates) {
    for (const t of c.tags || []) {
      const k = t.toLowerCase();
      if (!seenTag.has(k)) { seenTag.add(k); tags.push(t); }
    }
  }

  const img = [...new Set(candidates.flatMap(c => c.img || []))];
  const proposed = {
    id: best.id, name: mergeLangs('name'), cells: best.cells,
    rules: best.rules, pos: best.pos, tags, img,
  };
  const desc = mergeLangs('desc');
  if (Object.keys(desc).length) proposed.desc = desc;
  return proposed;
}

// ── queue ─────────────────────────────────────────────────────────────────────

/** Pending review items: canonical dup groups + external (sync) proposals. */
function buildQueue(entries, decisions, extraQueue) {
  const overridden = new Set((decisions.overrides || []).map(o => o.key));

  const groups = new Map();
  for (const e of entries) {
    const key = canonicalKey(e.pos, e.rules);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const items = [];
  for (const [key, grp] of groups) {
    if (grp.length < 2) continue;
    items.push({ type: 'dedup', key, candidates: grp, proposed: proposeMerge(grp) });
  }

  const addedIds = new Set((decisions.additions || []).map(a => a.id));
  for (const item of (extraQueue && extraQueue.items) || []) {
    if (overridden.has(item.key)) continue;                              // decided via override
    if (item.type === 'add' && addedIds.has(item.proposed.id)) continue; // already accepted
    items.push(item);
  }
  return items;
}

/** Record the human verdict: replace the key's canonical group with `entries`. */
function applyMergeDecision(decisions, key, entries, note) {
  decisions.overrides = decisions.overrides || [];
  const existing = decisions.overrides.find(o => o.key === key);
  const record = { key, note: note || `review: merged ${new Date().toISOString().slice(0, 10)}`, entries };
  if (existing) Object.assign(existing, record);
  else decisions.overrides.push(record);
  return decisions;
}

/** Record an accepted "add" proposal: upsert into decisions.additions by id. */
function applyAddDecision(decisions, entry) {
  decisions.additions = decisions.additions || [];
  const i = decisions.additions.findIndex(a => a.id === entry.id);
  if (i >= 0) decisions.additions[i] = entry;
  else decisions.additions.push(entry);
  return decisions;
}

module.exports = { buildQueue, proposeMerge, applyMergeDecision, applyAddDecision };

// ── server ────────────────────────────────────────────────────────────────────

function createServer(opts) {
  const readJson = (p, fallback) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback);

  const queue = () => {
    const decisions = readJson(opts.decisions, { v: 1, overrides: [], additions: [], translations: {} });
    const { entries } = buildEntries(fs.readFileSync(opts.ini, 'utf8'), decisions);
    const extra = opts.queueFile ? readJson(opts.queueFile, null) : null;
    return buildQueue(entries, decisions, extra);
  };

  return http.createServer((req, res) => {
    const done = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8` });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };

    if (req.method === 'GET' && req.url === '/') {
      return done(200, fs.readFileSync(path.join(__dirname, 'review.html'), 'utf8'), 'text/html');
    }
    if (req.method === 'GET' && req.url === '/api/queue') {
      return done(200, { items: queue() });
    }
    if (req.method === 'POST' && req.url === '/api/decision') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const { key, entries, note, kind } = JSON.parse(body);
          const decisions = readJson(opts.decisions, { v: 1, overrides: [], additions: [], translations: {} });
          if (kind === 'addition') applyAddDecision(decisions, entries[0]);
          else applyMergeDecision(decisions, key, entries, note);
          fs.writeFileSync(opts.decisions, JSON.stringify(decisions, null, 2), 'utf8');
          done(200, { ok: true });
        } catch (e) {
          done(400, { ok: false, error: String(e.message || e) });
        }
      });
      return;
    }
    done(404, { ok: false });
  });
}

if (require.main === module) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : dflt;
  };
  const opts = {
    port: parseInt(arg('--port', '3210'), 10),
    ini: arg('--ini', 'chests.ini'),
    decisions: arg('--decisions', path.join(__dirname, 'db-decisions.json')),
    queueFile: arg('--queue', path.join(__dirname, 'review-queue.json')),
  };
  createServer(opts).listen(opts.port, () => {
    process.stderr.write(`Review tool: http://localhost:${opts.port}\n`);
  });
}
