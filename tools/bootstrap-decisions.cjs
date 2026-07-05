#!/usr/bin/env node
'use strict';

// One-time migration: chests.json has diverged from chests.ini (translations,
// manual dedup done directly in the JSON), so a plain rebuild would destroy
// that work. This tool freezes the divergence into tools/db-decisions.json:
// every canonical group whose regenerated content differs from the current
// chests.json is recorded as an override carrying the CURRENT json content.
// After that, `npm run build:db` reproduces today's DB and no past decision
// is ever re-asked (git-rerere style).

const fs = require('fs');
const { buildEntries, canonicalKey } = require('./ini2json.cjs');

/** Stable serialization: object key order must not cause false diffs. */
function normEntry(e) {
  const sortObj = o => o ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) : o;
  return JSON.stringify({
    id: e.id, name: sortObj(e.name), cells: e.cells, rules: e.rules,
    pos: e.pos, tags: e.tags, img: e.img, desc: sortObj(e.desc),
  });
}

function groupByKey(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = canonicalKey(e.pos, e.rules);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return groups;
}

function sameGroup(a, b) {
  if (a.length !== b.length) return false;
  const ser = g => g.map(normEntry).sort().join('\n');
  return ser(a) === ser(b);
}

/**
 * Diff regenerated-from-ini entries against the current chests.json entries.
 * @returns {{decisions: object, stats: object}}
 */
function bootstrapDecisions(regen, current) {
  const gR = groupByKey(regen);
  const gC = groupByKey(current);

  const overrides = [];
  const additions = [];
  let equal = 0, rescued = 0;

  for (const [key, cGrp] of gC) {
    const rGrp = gR.get(key);
    if (!rGrp) {
      // No ini counterpart at all — the entry lives only in the current json
      additions.push(...cGrp);
      continue;
    }
    if (sameGroup(rGrp, cGrp)) {
      equal++;
    } else {
      overrides.push({ key, note: 'bootstrap: frozen from chests.json', entries: cGrp });
    }
  }

  for (const [key, rGrp] of gR) {
    if (!gC.has(key)) rescued += rGrp.length;  // newly rescued (e.g. nameless) — keep, no decision
  }

  return {
    decisions: { v: 1, overrides, additions, translations: {} },
    stats: { equal, overrides: overrides.length, additions: additions.length, rescued },
  };
}

module.exports = { bootstrapDecisions };

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const force = process.argv.includes('--force');
  const [iniPath, jsonPath, outPath] = ['chests.ini', 'chests.json', 'tools/db-decisions.json'];

  if (fs.existsSync(outPath) && !force) {
    process.stderr.write(`${outPath} already exists — bootstrap is one-time. Use --force to overwrite.\n`);
    process.exit(1);
  }

  const regen = buildEntries(fs.readFileSync(iniPath, 'utf8'), null).entries;
  const current = JSON.parse(fs.readFileSync(jsonPath, 'utf8')).entries;

  const { decisions, stats } = bootstrapDecisions(regen, current);
  fs.writeFileSync(outPath, JSON.stringify(decisions, null, 2), 'utf8');

  process.stderr.write(
    `Groups equal: ${stats.equal}  frozen as overrides: ${stats.overrides}\n` +
    `Json-only entries → additions: ${stats.additions}  rescued from ini (no decision): ${stats.rescued}\n` +
    `Written: ${outPath}\n`
  );
}
