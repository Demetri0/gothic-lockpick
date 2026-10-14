#!/usr/bin/env node
'use strict';

// git pre-push: test exactly what is being pushed. The tip of each pushed ref
// (tags peeled, duplicates and commits already on a remote-tracking ref skipped)
// runs the Playwright suite in a temporary worktree — never against uncommitted
// or untracked files — with a hook-owned config on its own port, so a server
// from the main checkout is never reused. The corpus sweep (every DB chest) is
// added when solver logic, move rules, DB-entry conversion or chests.json
// changed since the remote's version; an unknown base runs it.
// Pushes take minutes: agents run `git push` with a 600000 ms timeout or in the background.

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ZERO = /^0+$/;
const CORPUS_BLOCKS = ['solver-src', 'game-logic', 'codecs'];     // whole blocks the corpus exercises
const CORPUS_FUNCS = ['entryToPlates', 'validatePlates', 'loadChestDb', 'makePlate'];  // DB conversion/loading
const CORPUS_CONSTS = ['DEFAULT_POSITIONS'];

function parseRefs(text) {
  return text.split('\n').map(l => l.trim().split(/\s+/)).filter(p => p.length === 4)
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({ localRef, localSha, remoteRef, remoteSha }));
}

function blockSrc(html, id) {
  const m = html.match(new RegExp(`<script\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)</script>`));
  return m ? m[1] : null;
}

/** Source of a top-level `function name(` by brace matching; null if not found. */
function fnSrc(html, name) {
  const start = html.search(new RegExp(`\\bfunction ${name}\\s*\\(`));
  if (start < 0) return null;
  const open = html.indexOf('{', start);
  for (let i = open, depth = 0; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  return null;
}

const constSrc = (html, name) => (html.match(new RegExp(`\\bconst ${name}\\s*=[^;]*;`)) || [null])[0];

function corpusNeeded(oldHtml, newHtml, chestsChanged) {
  if (chestsChanged || oldHtml == null || newHtml == null) return true;
  // Present in one version only, or different in both, counts as changed; absent from both is unchanged.
  const differs = (get, keys) => keys.some(k => get(oldHtml, k) !== get(newHtml, k));
  return differs(blockSrc, CORPUS_BLOCKS) || differs(fnSrc, CORPUS_FUNCS) || differs(constSrc, CORPUS_CONSTS);
}

function planPush(refs, git) {
  const seen = new Set(), jobs = [];
  for (const r of refs) {
    if (ZERO.test(r.localSha)) continue;                       // branch deletion
    const commit = git.peel(r.localSha);
    if (!commit || seen.has(commit)) continue;
    seen.add(commit);
    if (git.onRemote(commit)) continue;                        // already pushed (and tested) before
    const base = !ZERO.test(r.remoteSha) && git.exists(r.remoteSha) ? git.peel(r.remoteSha) : git.mergeBase(commit);
    jobs.push({ commit, corpus: base == null || corpusNeeded(git.show(base, 'index.html'), git.show(commit, 'index.html'), git.chestsChanged(base, commit)) });
  }
  return jobs;
}

/** Playwright config written into the worktree: the commit's own config, on a private port. */
function hookConfig(port) {
  return `import base from './playwright.config.js';
export default { ...base,
  use: { ...base.use, baseURL: 'http://localhost:${port}' },
  webServer: { ...base.webServer, command: 'npx serve . -p ${port} -n --no-clipboard', url: 'http://localhost:${port}', reuseExistingServer: false } };
`;
}

// ── real git + runner ────────────────────────────────────────────────────────
const sh = (args) => {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 }).trim(); }
  catch { return null; }
};
const remote = process.argv[2] || 'origin';
const realGit = {
  peel: s => sh(['rev-parse', '--verify', '--quiet', `${s}^{commit}`]),
  exists: s => sh(['cat-file', '-e', s]) !== null,
  onRemote: c => !!sh(['branch', '-r', '--contains', c]),
  mergeBase: c => sh(['merge-base', `refs/remotes/${remote}/main`, c]),
  show: (s, p) => sh(['show', `${s}:${p}`]),
  chestsChanged: (b, c) => spawnSync('git', ['diff', '--quiet', b, c, '--', 'chests.json']).status !== 0,
};

const run = (args, cwd, env) => spawnSync('npx', args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] }).status === 0;

function testCommit(job, root, port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lockpick-push-'));
  const short = job.commit.slice(0, 7);
  if (sh(['worktree', 'add', '--detach', tmp, job.commit]) === null) {
    process.stderr.write(`pre-push: could not create a worktree for ${short}\n`);
    return false;
  }
  try {
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'));
    fs.writeFileSync(path.join(tmp, 'pw-hook.config.mjs'), hookConfig(port));
    const env = { ...process.env };
    delete env.CHEST; delete env.RUN_CORPUS;
    process.stderr.write(`pre-push: testing ${short}\n`);
    if (!run(['playwright', 'test', '--config', 'pw-hook.config.mjs'], tmp, env)) return false;
    if (job.corpus) {
      process.stderr.write(`pre-push: ${short} changes solver/DB code or data — running the corpus sweep\n`);
      if (!run(['playwright', 'test', '--config', 'pw-hook.config.mjs', 'tests/corpus.spec.js'], tmp, { ...env, RUN_CORPUS: '1' })) return false;
    }
    return true;
  } finally {
    sh(['worktree', 'remove', '--force', tmp]);
  }
}

if (require.main === module) {
  sh(['worktree', 'prune']);                                   // leftovers of an interrupted push
  const jobs = planPush(parseRefs(fs.readFileSync(0, 'utf8')), realGit);
  const root = sh(['rev-parse', '--show-toplevel']);
  let port = 3100;
  for (const job of jobs) if (!testCommit(job, root, port++)) process.exit(1);
}

module.exports = { parseRefs, blockSrc, fnSrc, corpusNeeded, planPush, hookConfig };
