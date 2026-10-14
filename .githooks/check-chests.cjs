#!/usr/bin/env node
'use strict';

// pre-commit / pre-merge-commit: when the DB data, its decisions or its builder
// is staged, rebuild the entries with the *staged* builder and decisions from
// chests.ini and reject any difference from the staged chests.json (`updated`
// ignored). chests.json is generated — a hand edit, or a decisions change
// committed without a rebuild, would deploy a stale DB. Works for any agent or
// person; chests.ini is local-only, so without it the check warns and passes.

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const TRIGGERS = ['chests.json', 'tools/db-decisions.json', 'tools/ini2json.cjs'];
const REASON = 'chests.json in this commit does not match a fresh build of chests.ini + tools/db-decisions.json. '
  + 'chests.json is generated: record the change in tools/db-decisions.json and run `npm run build:db` '
  + '(see the update-chest-db skill). Bypass only deliberately: git commit --no-verify.';

function checkChests({ stagedJson, stagedDecisions, ini, buildEntries }) {
  if (ini == null) return { ok: true, warn: 'chests.ini not found — skipped the chests.json consistency check.' };
  const fresh = buildEntries(ini, stagedDecisions ? JSON.parse(stagedDecisions) : null).entries;
  let staged;
  try { staged = JSON.parse(stagedJson).entries; } catch { return { ok: false, reason: 'chests.json is not valid JSON. ' + REASON }; }
  return JSON.stringify(fresh) === JSON.stringify(staged) ? { ok: true } : { ok: false, reason: REASON };
}

function git(args) {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }); }
  catch { return null; }
}

/** Load the staged tools/ini2json.cjs, so a builder change is checked as committed. */
function stagedBuilder(root) {
  const file = path.join(root, 'tools', 'ini2json.cjs');
  const src = git(['show', ':tools/ini2json.cjs']);
  if (src == null) return require(file).buildEntries;
  const m = new Module(file, module);
  m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(src, file);
  return m.exports.buildEntries;
}

if (require.main === module) {
  const staged = (git(['diff', '--cached', '--name-only']) || '').split('\n');
  if (!TRIGGERS.some(f => staged.includes(f))) process.exit(0);
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const iniPath = path.join(root, 'chests.ini');
  const r = checkChests({
    stagedJson: git(['show', ':chests.json']),
    stagedDecisions: git(['show', ':tools/db-decisions.json']),
    ini: fs.existsSync(iniPath) ? fs.readFileSync(iniPath, 'utf8') : null,
    buildEntries: stagedBuilder(root),
  });
  if (r.warn) process.stderr.write(`pre-commit: ${r.warn}\n`);
  if (!r.ok) { process.stderr.write(`pre-commit: ${r.reason}\n`); process.exit(1); }
}

module.exports = { checkChests, TRIGGERS };
