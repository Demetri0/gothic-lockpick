# AI Tooling & Docs Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (native execution, O7). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project's AI tooling and docs lean, structured and self-checking:
- a short always-loaded `CLAUDE.md`/`AGENTS.md`;
- shared reference docs in `docs/`;
- workflows as skills;
- an English README written for humans;
- mechanical checks for the rules that are costly to break.

**Architecture:** Knowledge is placed by when it is needed.
1. **Always loaded:** `CLAUDE.md` (≤ 6 KB, `AGENTS.md` is a symlink to it). It holds commands, a map, and one-line rules with their reason and a pointer.
2. **Reference:** shared by humans and agents, in English:
   - `docs/architecture.md`;
   - `docs/formats.md`;
   - `docs/db-pipeline.md`;
   - `docs/user-guide.md`.

   They replace the deep material in today's `CLAUDE.md` and Russian README.
3. **Procedures:** skills in `.agents/skills/` (symlinked into `.claude/skills/`): `update-chest-db` and a new `release`.
4. **Checks:**
   - Claude Code `permissions.deny` on the DB files;
   - git `pre-commit`/`pre-merge-commit` that rebuild and compare `chests.json`;
   - git `pre-push` that tests the tip of each pushed ref in a temporary worktree and adds the corpus sweep when needed;
   - a conventions spec for test selectors and URL writes.

**Tech Stack:** Markdown; Node CommonJS scripts (as in `tools/`); Playwright runner incl. pure-node specs (as `tests/db-pipeline.spec.js`); Claude Code settings; git hooks via `core.hooksPath=.githooks` (already configured).

**Spec:**
- This session's assessment.
- Three independent plan reviews (round 1: a Claude subagent with 37 findings and codex with 57; round 2: a Claude subagent with 48). All checked claims were verified.
- The user's decisions D1–D21 below.
- Baseline onboarding score **38/44** (codex, 22 questions; see Task 12).

## User decisions (binding — do not revisit)

- **D1** Commits follow Conventional Commits: `type(scope): summary`. Types: `feat fix refactor perf style test docs ci chore`. Mark breaking changes with `!`. The release commit is `chore(release): X.Y.Z`.
- **D2** The tag `vX.Y.Z` goes on the commit `main` points to after the release: the merge commit if the work came through a branch, otherwise the release commit.
- **D3** Use a branch for large planned work or anything that may not ship (experiments, "maybe not now"). Everything else goes directly to `main`. Merge branches with `--no-ff`, titled `Merge: <summary>`.
- **D4** URL writes:
  - callers use `urlReplace` (config edits) or `urlPush` (stage changes);
  - both are thin wrappers over an internal `urlWrite`;
  - nothing else calls `history.replaceState`/`pushState`.

  Word the rule so agents call the wrappers, not `urlWrite`.
- **D5** Two URL readers, both through `urlReadConfig`: `urlApplyOnLoad` (page load) and `urlReconcile` (back/forward). Neither calls the other.
- **D6** The single implementation points are one rule ("this logic exists in exactly one place; extend it, don't copy it"), with each point's role stated.
- **D7** Drum paste supports both forms by deterministic inference from the code (`posReplaceAll`). Document what the code does, not what old docs said.
- **D8** A known critical defect: a pasted digit run that fits neither form gets per-digit clamping instead of rejection. **Record it for later; do not fix in this plan** (see Follow-ups).
- **D9** Tests follow Playwright best practices; docs list only project specifics. `beforeEach` holds what every test in the file shares (navigation, network mocks).
- **D10** Test names and comments are English. Quoting UI strings is fine.
- **D11** Run the corpus when solver logic, move rules, DB-entry conversion, or `chests.json` changed.
- **D12** Run the suite after a meaningful chunk of work or when unsure about a detail. Not after every small edit, CSS included. pre-push is the backstop.
- **D13** Document the test-id naming convention.
- **D14** Locale sets: point at the source of truth and give the current values (UI: `TRANSLATIONS` keys; DB names: `LANGS` in `tools/translate-gaps.cjs`).
- **D15** i18n is one documented mechanism: `data-i18n*` attributes re-applied by `setLanguage`, plus rules for when `t()` is acceptable.
- **D16** Never drop a DB entry without asking the user, explaining why it is needed and why it is right.
- **D17** Source weights and the doubt threshold change only after discussion. Any "recorded in game" claim reads "**presumably** recorded in game".
- **D18** Every statement about DB data is hedged. It is third-party data of unknown accuracy, so we state what was compared and how confident we are, never "verified"/"wrong".
- **D19** Agent docs, skills, CHANGELOG, release notes and the README are in English. The README is rewritten for humans: structured, current, shorter, no Russian version, no license section.
- **D20** `main.ts`, `mise.toml` and `.codex/` go into `.gitignore`. Remove `Bash(git commit *)` from the user's local allowlist.
- **D21** The released 1.6.0 CHANGELOG section is reworded to follow D18. The meaning of the changes stays; only the certainty of the claims changes.

## Organization decisions (made by the planner; may change during execution only with a recorded reason)

- **O1 DB file protection, in two layers:**
  - (a) A Claude Code `permissions.deny` on `Edit(/chests.json)` and `Edit(/chests.ini)`. Per the permissions docs, `Write(path)` rules are never consulted. Edit rules cover Claude's file tools, Bash file commands such as `sed`/`tee`, and redirection targets, but not arbitrary subprocesses (so `npm run build:db` keeps working, and so does `node -e …`).
  - (b) A tool-agnostic `pre-commit` (also linked as `pre-merge-commit`). It runs when `chests.json`, `tools/db-decisions.json` or `tools/ini2json.cjs` is staged. It rebuilds the entries with the **staged** builder and the staged decisions from `chests.ini`, and rejects any difference, ignoring `updated`. Without `chests.ini` it warns and passes.

  Docs describe this as "blocked for Claude's file tools and shell redirection; caught at commit by pre-commit". The Bash-regex hook is dropped.
- **O2 pre-push tests the tip of each pushed ref.** Tags are peeled and duplicates removed. Refs whose commit is already on a remote-tracking ref are skipped.
  - It always tests in a temporary `git worktree`, so partial commits and untracked files never leak in. The worktree uses a hook-owned Playwright config that imports the commit's own config and overrides the port (31xx) with `reuseExistingServer: false`, so it works for old commits too.
  - It adds the corpus when D11 applies, compared with the remote sha, or else the merge-base with `refs/remotes/<remote>/main`. An unknown base runs it.
  - It clears `CHEST`/`RUN_CORPUS` and runs `git worktree prune` first.
  - Agent-run pushes take minutes, so use a 600000 ms timeout or a background run.
- **O3** Reference docs are shared by humans and agents in `docs/`, not a separate `docs/agents/`.
- **O4** Every independently meaningful statement in today's `CLAUDE.md`, the skill and the README survives in **one authoritative detailed home**. Short summaries may repeat it; a statement may be dropped only with a recorded reason (obsolete or wrong). Task 7 keeps a clause-level inventory.
- **O5** Moved text is verbatim except for verified factual corrections, each listed in the commit body. Known corrections:
  - `urlApplyOnLoad` is defined in `url` and called from `init`;
  - "four mutation points" is stale (five `urlReplace` config sites);
  - "shift the whole run" for DB `pos` really means: +1 to the whole run, and an out-of-range entry is rejected (`validatePlates`);
  - «Ограничения» says positions are "odd, minimum 3", but the app is fixed at 7.
- **O6** `release` loads for direct release requests only. Its description names those; status questions are not in it and are true negatives in Task 13. The body still starts with the intent gate: a question gets a status answer, not actions. After an explicit request, steps 0–4 (including a test run) happen locally without further questions. Push (= deploy) needs a separate go-ahead.
- **O7** Execution: native (the planner implements every task), then one fresh reviewer for the whole branch. codex is not the implementer here: the tasks are mostly interlinked docs whose context lives in this session. It stays available as a second review seat.

## Global Constraints

- `AGENTS.md` stays a symlink to `CLAUDE.md`. Skills live in `.agents/skills/<name>/` with relative symlinks `.claude/skills/<name> -> ../../.agents/skills/<name>`.
- `CLAUDE.md` ≤ 6 000 bytes (`wc -c`).
- No new npm dependencies.
- Stage files by name; never `git add -A`/`.`.
- New hook files are executable: `git ls-files -s <file>` shows `100755`.
- Branch `chore/ai-tooling` (Task 0). Push only on the user's word.

## Review Focus

1. The `pre-commit` check passes on the untouched repo with `chests.ini` present. Run it manually in Task 2; it is not part of the suite (see Task 2).
2. The `pre-push` worktree run never hits a server from the main checkout: the hook-owned config sets its own port and `reuseExistingServer: false` (Task 3 tests + manual checks after the commit).
3. The selector lint accepts every legitimate form in today's tests and rejects class/tag/id/comma/concatenated selectors and `getByText`-style calls (Task 1 self-tests; dry-run on today's tests = 0 violations).
4. No knowledge is lost: the clause inventory (Task 7) maps every clause of old `CLAUDE.md`, the skill and README sections to a home, checked by grep.
5. The release skill must not act on a question. The description is release-only and the body starts with the gate (Task 5).

---

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `docs/superpowers/plans/2026-10-15-ai-tooling.md` | this plan, committed | 0 |
| `tests/conventions.spec.js` | lint: test locators, app-side test-id queries, URL write discipline | 1, 4 |
| `.claude/settings.json` | shared: plugin, `permissions.deny` (DB files), `permissions.allow` | 2, 9 |
| `.githooks/pre-commit`, `.githooks/pre-merge-commit` (symlink), `.githooks/check-chests.cjs`, `tests/check-chests.spec.js` | DB consistency check | 2 |
| `.githooks/pre-push`, `.githooks/pre-push.cjs`, `tests/pre-push.spec.js` | per-ref-tip suite in a worktree + conditional corpus | 3 |
| `index.html` (`url` block) | `urlWrite` + thin wrappers | 4 |
| `.agents/skills/release/SKILL.md` + symlink | release procedure | 5 |
| `package-lock.json`, `docs/releases/v1.6.0.md` | lock version 1.6.0; notes fixed and hedged | 5 |
| `.agents/skills/update-chest-db/SKILL.md`, `tools/sync-catalogs.cjs` (comments only) | DB procedure absorbs DB rules; D14/D16–D18 wording | 6 |
| `docs/architecture.md`, `docs/formats.md`, `docs/db-pipeline.md`, `docs/user-guide.md` | shared reference (English) | 7 |
| `CLAUDE.md`, `docs/superpowers/README.md` | rewritten ≤ 6 KB; historical-docs pointer | 7 |
| `README.md` | English, human-oriented | 8 |
| `.gitignore`, `.claude/settings.local.json` (personal) | D20 | 9 |
| `~/.claude/projects/…/memory/*` (outside repo) | memories aligned with D12/D16/D20 | 10 |
| `CHANGELOG.md` | `[Unreleased]` entries + 1.6.0 fixes | 5, 11 |
| skill eval sets | trigger evals (last) | 13 |

---

### Task 0: Branch and plan

- [ ] `git status --short` shows exactly: `?? docs/releases/`, `?? docs/superpowers/plans/2026-10-15-ai-tooling.md`, `?? main.ts`, `?? mise.toml`.
- [ ] `git checkout -b chore/ai-tooling`
- [ ] `git add docs/superpowers/plans/2026-10-15-ai-tooling.md && git commit -m "docs(plans): AI tooling and docs restructure plan"`

---

### Task 1: Conventions lint

**Files:** Create `tests/conventions.spec.js`

**Interfaces:**
- Produces: the functions `stripComments(src)`, `locatorViolations(src)` and `appTestIdQueries(src)`, defined inside the spec.
- Task 4 appends a URL-write test to the same file.

- [ ] **Step 1: Write the spec**

```js
import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Conventions cheap to check mechanically (CLAUDE.md → Testing). Scope, stated
// honestly: Playwright locator/selector calls in test files, DOM queries by
// test id in app code, and URL writes. Not checked: DOM queries inside
// page.evaluate() (tests read computed styles and markup there) and code after
// a regex literal containing `//` (stripComments is a small scanner, not a parser).

const TESTS = fileURLToPath(new URL('./', import.meta.url));
const walk = d => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(spec\.)?js$/.test(f) ? [p] : [];
});

/** Blank out // and /* *\/ comments, keeping strings and line numbers intact. */
function stripComments(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (q) { out += c; if (c === '\\') { out += n ?? ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; } i += 2; continue; }
    out += c; i++;
  }
  return out;
}

// One or more compounds joined by whitespace or `>`. Each compound is a
// data-test-id attribute (any operator) followed by optional extra attribute
// filters. No classes, tags, ids, commas or pseudo-classes.
const ATTR = String.raw`\[[a-z][a-z0-9-]*(?:[\^$*|~]?=(?:"[^"]*"|'[^']*'))?\]`;
const COMPOUND = String.raw`\[data-test-id[\^$*|~]?=(?:"[^"]*"|'[^']*')\](?:${ATTR})*`;
const SELECTOR = new RegExp(String.raw`^\s*${COMPOUND}(?:\s*>\s*${COMPOUND}|\s+${COMPOUND})*\s*$`);
// Playwright calls whose first argument is a selector string.
const SELECTOR_CALL = String.raw`(?:\.\s*(?:locator|frameLocator)|\bpage\.\s*(?:\$\$?|\$\$?eval|waitForSelector|click|dblclick|fill|check|uncheck|hover|press|type|selectOption|tap|focus|textContent|innerText|innerHTML|getAttribute|isVisible|isHidden|isEnabled|isDisabled|isChecked))\s*\(`;

function locatorViolations(src) {
  const code = stripComments(src), out = [];
  const lineOf = idx => code.slice(0, idx).split('\n').length;
  for (const m of code.matchAll(/\.\s*(getByText|getByRole|getByLabel|getByPlaceholder|getByTitle|getByAltText)\s*\(/g))
    out.push(`${lineOf(m.index)}: ${m[1]}()`);
  for (const m of code.matchAll(/\bhasText\s*:/g)) out.push(`${lineOf(m.index)}: filter({ hasText })`);
  const re = new RegExp(SELECTOR_CALL + String.raw`\s*(?:(['"\`])((?:\\.|(?!\1)[\s\S])*)\1(\s*\+)?|([^)'"\`\s][^)]*))`, 'g');
  for (const m of code.matchAll(re)) {
    const [, , selector, concat] = m;
    if (selector === undefined || concat) out.push(`${lineOf(m.index)}: non-literal selector`);
    else if (!SELECTOR.test(selector.replace(/\$\{[^}]*\}/g, 'x'))) out.push(`${lineOf(m.index)}: '${selector}'`);
  }
  return out;
}

function appTestIdQueries(src) {
  return src.split('\n').flatMap((l, i) =>
    /(querySelector(All)?|closest|matches)\s*\(\s*['"`][^'"`]*data-test-id/.test(l) || /dataset\.testId(?!\s*=[^=])/.test(l)
      ? [`${i + 1}: ${l.trim()}`] : []);
}

test('the locator lint accepts every test-id form and rejects everything else', () => {
  for (const ok of [
    `page.getByTestId('btn-start')`,
    `page.locator('[data-test-id="pos-input-1"]')`,
    `page.locator('[data-test-id^="search-result-0-hole-"][data-active="true"]')`,
    `page.locator('[data-test-id="toast"][data-test-type="success"]').last()`,
    `page.locator(\`[data-test-id="mini-cell-\${r}-\${c}"]\`)`,
    `page.locator('[data-test-id="a"] [data-test-id="b"]')`,
    `page.locator('[data-test-id="a"] > [data-test-id="b"]')`,
    `page.keyboard.press('Control+k')`,
    `// page.getByText('commented out')`,
  ]) expect(locatorViolations(ok), ok).toEqual([]);
  for (const bad of [
    `page.getByText('Go')`, `page.getByRole ('button')`, `page.locator('#btn-start')`,
    `page.locator('.btn-primary')`, `page.locator('[data-test-id="x"] .btn')`,
    `page.locator('[data-test-id="x"], button')`, `page.locator(selector)`,
    `page.locator(\n  '.multi-line'\n)`, `rows.filter({ hasText: 'x' })`,
    `page.click('#x')`, `page.$('.row')`, `page.waitForSelector('.x')`,
    `page.locator('[data-test-id="a"]' + '.x')`,
  ]) expect(locatorViolations(bad), bad).not.toEqual([]);
});

test('test files locate elements only by data-test-id', () => {
  const found = walk(TESTS).filter(f => !f.endsWith('conventions.spec.js'))
    .flatMap(f => locatorViolations(readFileSync(f, 'utf8')).map(v => `${f.slice(TESTS.length)}:${v}`));
  expect(found, found.join('\n')).toEqual([]);
});

test('app code never queries the DOM by data-test-id (test ids are for tests)', () => {
  const found = appTestIdQueries(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  expect(found, found.join('\n')).toEqual([]);
});
```

- [ ] **Step 2: Run** `npx playwright test tests/conventions.spec.js`. Expected: PASS (3 tests). If "test files" fails, read each reported line. A legitimate form the grammar misses means: widen `ATTR`/`COMPOUND` and add it to the self-test. A real violation means: report it to the user, don't silently allowlist it.
- [ ] **Step 3: Commit** `git add tests/conventions.spec.js && git commit -m "test: lint test locators and app-side test-id queries"`

---

### Task 2: DB file protection

**Files:**
- Create: `.githooks/pre-commit`, `.githooks/pre-merge-commit` (symlink → `pre-commit`), `.githooks/check-chests.cjs`, `tests/check-chests.spec.js`.
- Modify: `.claude/settings.json`.

**Interfaces:**
- Produces, exported from `check-chests.cjs`:
  - `checkChests({ stagedJson: string, stagedDecisions: string|null, ini: string|null, buildEntries: fn }) → { ok: boolean, warn?: string, reason?: string }`;
  - `TRIGGERS: string[]`.

- [ ] **Step 1: Write the failing tests**

```js
import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

// pre-commit consistency check: a committed chests.json must equal a fresh build
// of chests.ini + tools/db-decisions.json (the `updated` stamp aside), whoever
// or whatever edited it. The real-repository comparison is a manual step of the
// hook (it depends on the local-only chests.ini), not part of this suite.

const require = createRequire(import.meta.url);
const { checkChests, TRIGGERS } = require('../.githooks/check-chests.cjs');
const { buildEntries, canonicalKey } = require('../tools/ini2json.cjs');

const INI = `"[test_chest_one]
name=""Тестовый сундук""
cells=2
rules=""A:B-""
start_pos=""1,2""
tags=""тест"""
`;
const built = (ini, dec) => JSON.stringify({ v: 1, updated: 'any', entries: buildEntries(ini, dec).entries });
const check = (o) => checkChests({ buildEntries, stagedDecisions: null, ...o });

test('a chests.json matching a fresh build passes, whatever its timestamp', () => {
  expect(check({ stagedJson: built(INI, null), ini: INI }).ok).toBe(true);
});

test('a hand-edited chests.json is rejected with a pointer to db-decisions', () => {
  const edited = JSON.parse(built(INI, null)); edited.entries[0].pos = [3, 3];
  const r = check({ stagedJson: JSON.stringify(edited), ini: INI });
  expect(r.ok).toBe(false);
  expect(r.reason).toContain('tools/db-decisions.json');
});

test('a decisions change without a rebuild is rejected', () => {
  const dec = { v: 1, drops: [canonicalKey([1, 2], 'A:B-')] };
  expect(check({ stagedJson: built(INI, dec), stagedDecisions: JSON.stringify(dec), ini: INI }).ok).toBe(true);
  expect(check({ stagedJson: built(INI, null), stagedDecisions: JSON.stringify(dec), ini: INI }).ok).toBe(false);
});

test('without chests.ini the check passes with a warning', () => {
  const r = check({ stagedJson: '{}', ini: null });
  expect(r.ok).toBe(true);
  expect(r.warn).toContain('chests.ini');
});

test('the check triggers on the data, the decisions and the builder', () => {
  expect(TRIGGERS).toEqual(['chests.json', 'tools/db-decisions.json', 'tools/ini2json.cjs']);
});
```

- [ ] **Step 2: Run** `npx playwright test tests/check-chests.spec.js`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `.githooks/check-chests.cjs`**

```js
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
```

`.githooks/pre-commit`:

```sh
#!/bin/sh
exec node "$(git rev-parse --show-toplevel)/.githooks/check-chests.cjs"
```

Then run:

```bash
chmod +x .githooks/pre-commit
ln -s pre-commit .githooks/pre-merge-commit     # merges run the same check
```

- [ ] **Step 4: Run** the spec. Expected: PASS (5 tests).
- [ ] **Step 5: Real-repository check (manual, Review Focus 1).** Run `git add chests.json && node .githooks/check-chests.cjs; echo "exit $?"`. Expected: exit 0 with no output, since today's `chests.json` equals a fresh build. Then `git restore --staged chests.json`. If it fails, stop and investigate.
- [ ] **Step 6: Claude Code deny rules.** Add to `.claude/settings.json` (keep `enabledPlugins`):

```json
  "permissions": {
    "deny": ["Edit(/chests.json)", "Edit(/chests.ini)"]
  }
```

  `Write(...)` rules are never consulted (permissions docs). `/path` is relative to the project root for project settings. Wording everywhere: "blocked for Claude's file tools and shell redirection; caught at commit by pre-commit".
- [ ] **Step 7: User-run live check.** An executing agent can't open a fresh session itself, so ask the user to:
  1. start `claude` in the repo and ask it to change one character in `chests.json`. Expected: denied without a prompt;
  2. ask it to `echo x > chests.ini`. Expected: denied;
  3. run `npm run build:db` (works), then `git checkout chests.json chests-report.txt 2>/dev/null` to undo the timestamp change.
- [ ] **Step 8: Commit** `git add .githooks/pre-commit .githooks/pre-merge-commit .githooks/check-chests.cjs tests/check-chests.spec.js .claude/settings.json && git commit -m "feat(hooks): reject commits whose chests.json doesn't match a fresh build; deny agent edits"`. Then check that `git ls-files -s .githooks/pre-commit` shows `100755`.

---

### Task 3: pre-push per pushed ref tip

**Files:** Create `.githooks/pre-push.cjs`, `tests/pre-push.spec.js`. Modify `.githooks/pre-push`.

**Interfaces:**
- Produces the exports `parseRefs(text)`, `blockSrc(html, id)`, `fnSrc(html, name)`, `corpusNeeded(oldHtml, newHtml, chestsChanged)`, `planPush(refs, git)` and `hookConfig(port)`.
- `planPush` returns `[{ commit, corpus: boolean }]`.
- The `git` adapter has the members `peel(sha)`, `exists(sha)`, `onRemote(commit)`, `mergeBase(commit)`, `show(sha, path)` and `chestsChanged(base, commit)`.

- [ ] **Step 1: Write the failing tests**

```js
import { test, expect } from '@playwright/test';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseRefs, blockSrc, fnSrc, corpusNeeded, planPush, hookConfig } = require('../.githooks/pre-push.cjs');

const Z = '0'.repeat(40);
const page = ({ blocks = {}, fns = {} } = {}) => '<html>'
  + Object.entries({ 'solver-src': 's', 'game-logic': 'g', codecs: 'c', ui: 'u', ...blocks }).map(([id, s]) => `<script id="${id}">${s}</script>`).join('')
  + `<script id="config">${Object.entries({ entryToPlates: 'return 1;', validatePlates: 'return 2;', handler: 'x();', ...fns }).map(([n, b]) => `function ${n}(a) {\n  ${b}\n}`).join('\n')}</script>`
  + '</html>';

test('blockSrc tolerates extra attributes and reports a missing block as null', () => {
  expect(blockSrc('<script type="text/javascript" id="codecs">x</script>', 'codecs')).toBe('x');
  expect(blockSrc('<html></html>', 'codecs')).toBeNull();
});

test('fnSrc extracts a top-level function by brace matching', () => {
  expect(fnSrc(page(), 'entryToPlates')).toContain('return 1;');
  expect(fnSrc(page(), 'missing')).toBeNull();
});

test('corpus: needed for solver/move/codec blocks, DB conversion functions or chests.json; not for UI code', () => {
  expect(corpusNeeded(page(), page({ blocks: { ui: 'U' } }), false)).toBe(false);
  expect(corpusNeeded(page(), page({ fns: { handler: 'y();' } }), false)).toBe(false);   // config-block UI code
  for (const id of ['solver-src', 'game-logic', 'codecs'])
    expect(corpusNeeded(page(), page({ blocks: { [id]: 'X' } }), false), id).toBe(true);
  for (const fn of ['entryToPlates', 'validatePlates'])
    expect(corpusNeeded(page(), page({ fns: { [fn]: 'changed();' } }), false), fn).toBe(true);
  expect(corpusNeeded(page(), page(), true)).toBe(true);
  expect(corpusNeeded(null, page(), false)).toBe(true);
});

function fakeGit({ peel = {}, known = [], onRemote = [], mergeBase = null, html = {}, chests = [] } = {}) {
  return {
    peel: s => peel[s] ?? s, exists: s => known.includes(s), onRemote: c => onRemote.includes(c),
    mergeBase: () => mergeBase, show: s => html[s] ?? null, chestsChanged: (b, c) => chests.includes(c),
  };
}

test('deletions are skipped; tags are peeled and deduplicated with branches', () => {
  const refs = parseRefs(`refs/heads/main h1 refs/heads/main r0\nrefs/tags/v1 t1 refs/tags/v1 ${Z}\nrefs/heads/old ${Z} refs/heads/old r9\n`);
  expect(planPush(refs, fakeGit({ peel: { t1: 'h1' }, known: ['r0'], html: { r0: page(), h1: page() } })))
    .toEqual([{ commit: 'h1', corpus: false }]);
});

test('a commit already on a remote-tracking ref is not re-tested', () => {
  const refs = parseRefs(`refs/tags/v2 t2 refs/tags/v2 ${Z}\n`);
  expect(planPush(refs, fakeGit({ peel: { t2: 'h1' }, onRemote: ['h1'] }))).toEqual([]);
});

test('a new branch compares against the merge-base; no base means the corpus runs', () => {
  const refs = parseRefs(`refs/heads/x h1 refs/heads/x ${Z}\n`);
  expect(planPush(refs, fakeGit({ mergeBase: 'm', html: { m: page(), h1: page() } }))[0].corpus).toBe(false);
  expect(planPush(refs, fakeGit({ mergeBase: null }))[0].corpus).toBe(true);
});

test('several distinct ref tips each get their own job; chests.json triggers the corpus', () => {
  const refs = parseRefs('refs/heads/a h1 refs/heads/a r0\nrefs/heads/b h2 refs/heads/b r0\nrefs/heads/c h3 refs/heads/c r0\n');
  const jobs = planPush(refs, fakeGit({ known: ['r0'], chests: ['h3'],
    html: { r0: page(), h1: page(), h2: page({ blocks: { codecs: 'X' } }), h3: page() } }));
  expect(jobs).toEqual([{ commit: 'h1', corpus: false }, { commit: 'h2', corpus: true }, { commit: 'h3', corpus: true }]);
});

test('the hook config pins its own port and never reuses a server', () => {
  const cfg = hookConfig(3107);
  expect(cfg).toContain("from './playwright.config.js'");
  expect(cfg).toContain('3107');
  expect(cfg).toContain('reuseExistingServer: false');
});
```

- [ ] **Step 2: Run** `npx playwright test tests/pre-push.spec.js`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement `.githooks/pre-push.cjs`**

```js
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
```

`.githooks/pre-push` (replace the content, keep it executable):

```sh
#!/bin/sh
# Logic lives in pre-push.cjs (tested by tests/pre-push.spec.js). git passes the
# remote name/url as arguments and the ref list on stdin.
exec node "$(git rev-parse --show-toplevel)/.githooks/pre-push.cjs" "$@"
```

- [ ] **Step 4: Run** the spec. Expected: PASS (8 tests).
- [ ] **Step 5: Commit** `git add .githooks/pre-push .githooks/pre-push.cjs tests/pre-push.spec.js && git commit -m "ci(hooks): pre-push tests each pushed ref tip in a worktree, corpus when solver/DB changed"`
- [ ] **Step 6: Manual checks, after the commit,** with synthetic stdin. `git push --dry-run` also runs the hook; give the command a 600000 ms timeout.
  - (a) Run `printf 'refs/heads/chore/ai-tooling %s refs/heads/chore/ai-tooling %s\n' "$(git rev-parse HEAD)" "$(git rev-parse origin/main)" | .githooks/pre-push origin`. Expected: "testing <sha>", the suite passes in the worktree, and there is no corpus (no corpus code or data changed vs `origin/main`).
  - (b) With `npm start` running in the main checkout on port 3000, repeat (a). It still passes and serves on 3100. Afterwards `git worktree list` shows only the main tree.
  - (c) Repeat with the remote sha replaced by the root commit (`git rev-list --max-parents=0 HEAD`). Expected: the corpus runs.

---

### Task 4: `urlWrite`

**Files:** Modify `index.html` (`url` block) and `tests/conventions.spec.js`.

**Interfaces:**
- `urlWrite(plates, stage, mode: 'replace'|'push')` is internal.
- `urlReplace(plates, stage)` and `urlPush(plates, stage)` keep their signatures and call sites.

- [ ] **Step 1: Write the failing test** (append to `tests/conventions.spec.js`):

```js
test('the URL is written in one place: urlWrite (callers use urlReplace/urlPush)', () => {
  const html = stripComments(readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  // Bracket access to the history *methods* would dodge the count below. (The solver
  // has an unrelated local array named `history`, so match the method names.)
  expect(html, 'no bracket access to history methods').not.toMatch(/history\s*\[[^\]]*State/);
  const start = html.indexOf('function urlWrite(');
  expect(start, 'urlWrite exists').toBeGreaterThan(-1);
  const body = html.slice(start, html.indexOf('\n}', start));
  const all = [...html.matchAll(/history\.(replaceState|pushState)\s*\(/g)].length;
  const inside = [...body.matchAll(/history\.(replaceState|pushState)\s*\(/g)].length;
  expect(inside, 'urlWrite calls both history methods').toBe(2);
  expect(all, 'history.*State( appears only inside urlWrite').toBe(inside);
});
```

  Run it and expect FAIL: `urlWrite` doesn't exist yet.

- [ ] **Step 2: Implement.** Replace the bodies of `urlReplace`/`urlPush` with the following, keeping their existing doc comments:

```js
/** The one URL writer; callers use urlReplace (config edits) or urlPush (stage
 *  changes, so browser Back/Forward toggle the stage). Silent while
 *  syncingFromUrl, i.e. while the URL is being read back into the view. */
function urlWrite(plates, stage, mode) {
  if (syncingFromUrl) return;
  const q = urlQueryFor(plates, stage);
  if (!q) return;
  if (mode === 'push') history.pushState(null, '', q);
  else history.replaceState(null, '', q);
}
function urlReplace(plates, stage) { urlWrite(plates, stage, 'replace'); }
function urlPush(plates, stage) { urlWrite(plates, stage, 'push'); }
```

- [ ] **Step 3: Run** `npx playwright test tests/conventions.spec.js tests/url-persist.spec.js`. Expected: PASS.
- [ ] **Step 4: Commit** `git add index.html tests/conventions.spec.js && git commit -m "refactor(url): single URL writer behind urlReplace/urlPush"`

---

### Task 5: `release` skill and release-data fixes

**Files:**
- Create: `.agents/skills/release/SKILL.md` and the symlink `.claude/skills/release`.
- Modify: `package-lock.json`, `docs/releases/v1.6.0.md` (untracked today), `CHANGELOG.md` (1.6.0 fixes only; the `[Unreleased]` text is written in Task 11).

- [ ] **Step 1: Write `.agents/skills/release/SKILL.md`**

````markdown
---
name: release
description: Use when the user explicitly asks to cut a release of Gothic Lockpick — "make a release", "release 1.7.0", "bump the version and tag it", "prepare the release notes for the next version".
---

# Releasing Gothic Lockpick

## First: is this a release request?

Act only on a **direct, unambiguous request** to release ("cut 1.7.0", "make a release"). If the user asked a question instead — "did you tag it?", "is it released?", "what version are we on?" — answer it from `git describe --tags`, `git log`, `package.json` and CHANGELOG, offer a release if one is due, and take no actions. Once the user has asked for a release, do steps 0–4 without further questions; **pushing (step 5) deploys the site and always needs a separate go-ahead.**

## What a release is

- An annotated tag `vX.Y.Z` on the commit `main` points to after the release: the merge commit when the work came through a branch, otherwise the release commit.
- A CHANGELOG section `## [X.Y.Z] - YYYY-MM-DD` ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)).
- English release notes `docs/releases/vX.Y.Z.md`, the text the user pastes into a GitHub release (or `gh release create`, if `gh` is installed).
- Pushing `main` deploys GitHub Pages (`.github/workflows/static.yml`).

## Choose the version (semver)

- patch: fixes only.
- minor: new user-visible features or data (new locks count), backward compatible.
- major: breaks a shared link format (`?lock=`), the config codecs, or removes a feature.

## Steps

0. **Check.**
   - Current branch, and a clean `git status`.
   - `git describe --tags`; whether `vX.Y.Z` already exists (never reuse a tag).
   - `git fetch` (network), then whether `main` is behind `origin/main`.
   - Then run `npx playwright test`, plus `npm run test:corpus` if solver logic, move rules, DB-entry conversion or `chests.json` changed since the last tag. Stop on any failure.
   - If the work is already merged, skip the merge in step 2.
1. **Release commit**, on the branch if there is one, otherwise on `main`:
   - `npm version X.Y.Z --no-git-tag-version`. This updates `package.json` **and** `package-lock.json`.
   - In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` (today), and insert a fresh empty `## [Unreleased]` above it.
   - Write `docs/releases/vX.Y.Z.md`: players first, then a "For contributors" list. Include only changes that are in this release. Every claim about DB data is hedged (third-party data of unknown accuracy; see the `update-chest-db` skill).
   - Stage those four files by name and run `git commit -m "chore(release): X.Y.Z"`.
2. **Merge** (branch only). `git merge` can't read a message from stdin, so write it to a file and run `git checkout main && git merge --no-ff -F <file> <branch>`. Title: `Merge: <summary> (X.Y.Z)`; the body says what changed for users.
3. **Tag:** `git tag -a vX.Y.Z -F <file>`. The first line is `X.Y.Z — <summary>`, then a short paragraph (mirror `git show v1.5.0`).
4. **Report** what was done and show the release-notes text verbatim.
5. **Push, only after the user's go-ahead:** `git push origin main vX.Y.Z`.
   - Run it with a 600000 ms timeout or in the background. pre-push tests each pushed ref tip in a temporary worktree (plus the corpus when needed), and a failure aborts the push.
   - If a push is interrupted, run `git worktree prune`.
   - Then delete the merged branch locally (`git branch -d`), and on the remote too if it was pushed.
6. **After the push**, ask the user to confirm the Pages workflow run is green.

## Never

- Retag or rewrite anything already pushed. Fix forward with a new commit or a patch release.
- Release from a dirty tree or with failing tests.
````

- [ ] **Step 2: Symlink.** Run `ln -s ../../.agents/skills/release .claude/skills/release`. Then `head -3 .claude/skills/release/SKILL.md` should show the frontmatter.

- [ ] **Step 3: Fix release data.**
  - Run `npm version 1.6.0 --no-git-tag-version --allow-same-version`. Then `grep -n '"version"' package-lock.json | head -2` shows 1.6.0 twice.
  - In `docs/releases/v1.6.0.md`:
    - delete the bullet "The Pages deploy now runs on Node 24 actions…" (commit `d88b747` comes after the tag);
    - hedge the DB claims (D18). "contradict the real lock" becomes "contradict records presumably made in game", "The correct entries" becomes "the entries other sources agree with", and "every lock solves" becomes "every entry is solvable as recorded".
  - In `CHANGELOG.md`, 1.6.0 section (D21):
    - change "`sync-lock-catalogs` skill" to "`update-chest-db` skill";
    - in "Added", change "Every one solves" to "every entry is solvable as recorded";
    - replace the "Removed" bullet with exactly:

```markdown
- Three chest entries whose dependencies contradict records of the same locks that were
  presumably made in game. Replayed on those records, their solution would hit a wall on the
  2nd or 10th press: one of the two entries for Scatty's ring chest and two of the entries for
  the chest above the Arena. The entries for these chests that agree with other sources remain.
```

  - Apply the same wording to the matching passage of `docs/releases/v1.6.0.md`. Then tell the user that a GitHub release already published with the old text has to be edited by hand.

- [ ] **Step 4: Commit**

```bash
git add .agents/skills/release/SKILL.md .claude/skills/release docs/releases/v1.6.0.md CHANGELOG.md
git commit -m "docs(skills): add release skill; fix and hedge 1.6.0 release notes"
git add package-lock.json
git commit -m "chore: sync package-lock.json version with package.json (1.6.0)"
```

---

### Task 6: `update-chest-db` absorbs the DB rules

**Files:** Modify `.agents/skills/update-chest-db/SKILL.md` and `tools/sync-catalogs.cjs` (comments only).

- [ ] **Step 1: Add every clause below that the skill lacks** (from old `CLAUDE.md` lines 5, 11, 12 and README «База данных замков»). The intro is the text under the H1.
  - Intro:
    - `chests.ini` is never committed and may come from outside. Never edit it.
    - INI parsing is pipeline-only (`tools/ini2json.cjs`); the app's parsers never read INI syntax.
    - Edits are blocked for Claude's file tools and shell redirection (`permissions.deny`) and caught at commit by the `pre-commit` rebuild check.
  - Decisions table:
    - `drops` exist so that a re-imported ini cannot reintroduce bad entries.
    - Duplicate groups without a decision are reported `REVIEW-NEEDED`, never merged silently.
  - New section "Data model":
    - DB `pos` is 0-based (`0..6`). `entryToPlates` adds 1 to the whole run. An entry out of range is rejected (`validatePlates`), never clamped or shifted to fit.
    - Name languages: `LANGS` in `tools/translate-gaps.cjs` (currently ru, en, de, uk). The UI has three (`TRANSLATIONS`: ru, en, uk) (D14).
  - "Reading the report": what `R`/`T`/`X` mean (reversed plate order / links stored target→source / mirrored positions); outputs go to the gitignored `tools/catalogs/`; `sync-catalogs` never writes `drops`.
  - "Agreement score…": `#solve-doubt` finds the entry structurally (`findIdenticalChest`), so it also fires for imports and `?lock=` links.
  - "Translations": restore the full sequence.
    1. `--export`; translate each gap file (Google Translate or an equivalent machine translation); `--import <lang>`.
    2. The AI verification pass: check the staged texts against `tools/gothic-glossary.json`, the Gothic canon (names, places, terms) and the UI terms in `CLAUDE.md` → i18n; give the user a numbered list of suspicions with proposed fixes; patch staging after the user's verdicts.
    3. Only then `--finalize` and build.
  - New short section "Merging duplicates": `npm run review:db` is a web UI for one queue item at a time, used for dedup merges and enrichment proposals. Positions and rules there are read-only. A structural fix (wrong link or position) is an `overrides` entry written by hand in `tools/db-decisions.json`, proposed to the user first. Full description: `docs/db-pipeline.md`.
- [ ] **Step 2: Apply D16–D18.**
  - "Applying decisions": "Never add a `drop` without asking the user first. Explain what the evidence is, why dropping is needed, and why it is right rather than the softer `doubt` flag."
  - Add: "Source weights and the doubt threshold (`SOURCES` in `tools/sync-catalogs.cjs`) change only after discussion with the user."
  - Replace every "recorded in game", "in-game record" or "religiosa1-grade evidence" with "presumably recorded in game" wording.
  - Widen the wording rule to all statements about DB data, in UI, docs, release notes and replies.
- [ ] **Step 3: Remove** the volatile weights sentence (lines 75–76), replacing it with a pointer to `SOURCES`. Also remove "~3 min" (runtimes live only in `CLAUDE.md` → Commands). Replace the UI-terms glossary lines with the pointer "UI terms: see `CLAUDE.md` → i18n".
- [ ] **Step 4: `tools/sync-catalogs.cjs`, comments only.**
  - Line 154 `// recorded in game by hand` becomes `// presumably recorded in game by hand`.
  - The header's "verified by replaying" becomes "checked by replaying".
  - Run `node -e "require('./tools/sync-catalogs.cjs')"` and expect no error.
- [ ] **Step 5: Check.** Run `grep -nE "dsazz 3|~3 min|in-game record|religiosa1-grade" .agents/skills/update-chest-db/SKILL.md` and expect nothing. Then `wc -l` < 500. Then `npx playwright test tests/sync-catalogs.spec.js` and expect a pass.
- [ ] **Step 6: Commit** `git add .agents/skills/update-chest-db/SKILL.md tools/sync-catalogs.cjs && git commit -m "docs(skills): update-chest-db owns the DB rules; hedged data wording; drops need consent"`

---

### Task 7: Reference docs and the new `CLAUDE.md`

**Files:**
- Create: `docs/architecture.md`, `docs/formats.md`, `docs/db-pipeline.md`, `docs/user-guide.md`.
- Modify: `CLAUDE.md`, `docs/superpowers/README.md`.

- [ ] **Step 1: `docs/architecture.md`** (English). Sources: old `CLAUDE.md` lines 7–9, 14–17, 61, and README «Архитектура» (Воркеры, Решатель, Кеш решения, Структура стилей, Структура скриптов) and «Сложность генерации», translated. Sections:
  1. Overview.
  2. Script blocks: full list with one line each.
  3. Styles: full block list, cascade, `style-tokens` late-but-works, `.x.hidden`, no `!important`.
  4. Solver & workers: `solver-src`, unit-testable page globals, `createWorker` prepends it, never re-define in `worker-src`; worker pool; `bfsSolveGrouped` (minimal presses; fewest switches, with a greedy fallback over 200k-state corridors); solution cache; random-generation difficulty.
  5. Single implementation points (D6), one line of role each:
     - `posSetPlateValue`: one plate's position, incl. config-stage `A`/`D` with dependencies ignored; its side effects;
     - `applyPlates`: the whole config; bumps `solveId`;
     - `loadEntry`: a DB entry from any stage;
     - `stopAutoPlay` and `resetExploreState`: teardowns;
     - `isComputing`: the "solve running" check;
     - `lastPlayedIndex` in `renderSolvePanel`: the step cursor every renderer reads.

     Include the history: a review found the copied-teardown bug five times.
  6. URL state (D4, D5):
     - `urlWrite` behind `urlReplace`/`urlPush`;
     - `urlReadConfig` is used by `urlApplyOnLoad` (defined in `url`, called from `init`, defers `&solve` to `load`, toasts on a corrupted link) and by `urlReconcile` (the single popstate listener). **Neither calls the other.**
     - Every config mutation point calls `urlReplace`; entering and leaving solve use `urlPush`.
     - The solve stage serializes `solveStartPositions`; explore steps are never written.
  7. Read-only previews: the `render-preview` block, and its use in the import dialog with `findIdenticalChest`.
  8. Localization mechanism (D14, D15):
     - `TRANSLATIONS`: keys = UI locales, currently ru/en/uk; DB names use four, see `docs/db-pipeline.md`.
     - `t(key, vars)`; `setLanguage` re-applies `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`.
     - Markup that stays on screen across a switch carries the attributes. `t()` is for transient text (toasts) or markup re-rendered on switch.
     - Locale-independent symbols (`·`, `↩`) are exempt.
     - `tests/i18n.spec.js` fails on a key missing from any locale, a blank value, a `data-i18n` with no entry, and `t()` returning the key.
- [ ] **Step 2: `docs/formats.md`.**
  - Sources: old `CLAUDE.md` lines 10 and 18, plus README «Нотация ходов», «Форматы конфигурации» and «Ограничения», translated. Use exactly the heading `## Move notation`; the README links to it.
  - Write drum-paste base inference from the code, `posReplaceAll` (D7): a run containing `0` is 0-based; otherwise it is the displayed 1-based value; single-digit entry is always 1-based.
  - Add a "Known issue (critical, to fix)" box (D8): a run that fits neither form (both `0` and `7`, or digits `8`/`9`) is clamped digit by digit instead of rejected — e.g. `07` → 1,7 and `89` → 7,7. The intended behavior is to reject the whole run with a message; the codecs already reject out-of-range runs.
  - Contrast: DB position search tries both readings (`searchByPosition`); the hint matcher is 0-based by design.
  - Limits, corrected from «Ограничения» (O5): 2–8 plates, exactly 7 positions (`validatePlates`), dependency steps > 1 only via import, cycles allowed.
- [ ] **Step 3: `docs/db-pipeline.md`.** Translate README «База данных замков» into English: pipeline diagram, canonical key, decisions layer incl. `evidence`, entry format incl. `conf`/`doubt`/`alt`/`game`, name languages (`LANGS`: ru, en, de, uk), review tool, sync-uml, sync-catalogs, translations, migration history. Apply D17/D18 wording. Procedures stay in the skill; this is the reference, and it links to the skill.
- [ ] **Step 4: `docs/user-guide.md`.** Translate README «Использование» (Язык интерфейса, Вкладка настроек, Вкладка решения, Режим исследования, Ссылка на замок, Поиск по базе замков, Подсказки-совпадения, Согласованность с другими источниками) for users, with D18 wording. The README's "How to use" is the short version and links here.
- [ ] **Step 5: Replace `CLAUDE.md`, starting from this text.** Step 7's inventory may add a missing clause, within the size limit.

````markdown
# Gothic Lockpick

Disc-lock puzzle solver (BFS) with a 3D view, plus a searchable database of Gothic 1 Remake chest locks. The app is one HTML page with no build step (`index.html`; Fuse.js from a CDN); npm is only for development tools. The database `chests.json` is generated by a pipeline.

## Commands

```bash
npm start                # http://localhost:3000 — needs HTTP, the DB is fetched
npx playwright test      # full suite
npm run test:corpus      # solve every DB chest (~3 min); CHEST=<id-part> for one or a few
npm run build:db         # chests.ini + tools/db-decisions.json → chests.json
npm run sync:catalogs    # cross-check the DB against external catalogs
npm run review:db        # web UI for merging/enriching duplicate DB entries
```

## Where things live

- `index.html`: `<script>`/`<style>` blocks with semantic ids. Grep `id="<name>"`. What each owns: `docs/architecture.md`.
- `tools/`: DB pipeline. `tests/`: Playwright specs (some pure-node, for `tools/` and hooks).
- `docs/architecture.md`, `docs/formats.md`, `docs/db-pipeline.md`, `docs/user-guide.md`: read the relevant one before changing that area. `docs/releases/`: release notes. `docs/superpowers/`, `docs/review/`, `docs/reviews/`: historical, not current.
- Skills in `.agents/skills/` (symlinked into `.claude/skills/`): `update-chest-db` for any DB change, `release` for versions and tags.

## Rules

Each rule prevents a bug this project has had.

- **CSS** goes in the `<style>` block that owns its zone. The blocks form one sheet in document order, so moving a rule changes the cascade. No `!important`.
- **Solver code lives only in `solver-src`.** The worker is built from that block's text.
- **Config formats** are `Codecs.*` objects listed in `PARSERS`. `parse`/`serialize` never throw (`null` = not this format). A dependency without `+`/`-` invalidates the whole rule string.
- **One implementation per concern.** Extend these, never copy their logic: `posSetPlateValue`, `applyPlates`, `loadEntry`, `stopAutoPlay`, `resetExploreState`, `isComputing`, `lastPlayedIndex`. Roles: `docs/architecture.md`.
- **URL:** shareable state lives only in the query (`?lock=<dotted>[&solve]`). To write it, call `urlReplace` (config edits) or `urlPush` (stage changes); never call `history.*State` yourself.
- **i18n:** every user-visible string goes in all UI locales (`TRANSLATIONS` keys: ru, en, uk); locale-independent symbols (`·`, `↩`) are exempt. Markup that stays on screen across a language switch uses `data-i18n*` attributes, not a one-off `t()`. Terms: plate = «элемент» / «елемент» / "plate"; links = «связи» / «зв'язки» / "dependencies".
- **DB:** never edit `chests.json` (generated) or `chests.ini` (raw input). Changes go into `tools/db-decisions.json`, then `npm run build:db`. Claude's file tools are denied; pre-commit catches the rest. Never drop an entry without asking the user and explaining why. Use the `update-chest-db` skill.
- **DB data is third-party and of unknown accuracy.** Everything we say about it, in UI, docs or replies, states what was compared and how confident we are; never "verified" or "wrong".

## Testing

- Follow Playwright's best practices. Project specifics:
- Locate elements only by `data-test-id` (`getByTestId`, or `locator('[data-test-id…]')` plus attribute filters). If an element has none, add one to `index.html` first. Ids are kebab-case and start with the area (`search-result-0-name`, `pos-input-3`, `btn-start`); numbers are 1-based plate/step ids or 0-based list indexes. App code never queries by `data-test-id`; test ids are for tests. `tests/conventions.spec.js` checks locator calls and app-side queries.
- Names and comments in English; quoting UI strings is fine.
- `beforeEach` holds only what every test in the file shares (navigation, network mocks).
- `{ force: true }` on clicks inside the 3D scene (CSS 3D transforms affect hit-testing). Assert results, not transient states.
- Run the suite after a meaningful chunk of work or when unsure about a detail, not after every small edit. Run the corpus when solver logic, move rules, DB-entry conversion or `chests.json` changed.
- Gotchas:
  - A disabled `<button>`'s `title` never shows in Chromium. Put it on a wrapping `<span>` (see `#btn-search-db-wrap`).
  - After a success mock, a new failing `route()` plus a re-`goto` in the same test can still get the cached success response. Send `Cache-Control: no-store` on the success mock, or let the first load settle before clearing `localStorage`/re-navigating.
  - Don't read a boolean set by a fire-and-forget async check. `await` its promise.

## Git

- Conventional Commits: `type(scope): summary`; types `feat fix refactor perf style test docs ci chore`; `!` for breaking changes.
- Use a branch for large planned work or anything that may not ship; otherwise commit to `main`. Merge with `git merge --no-ff`, titled `Merge: <summary>`.
- Stage files by name; never `git add -A`/`.`.
- `.githooks/` (enable once: `git config core.hooksPath .githooks`): pre-commit verifies `chests.json` against a fresh build; pre-push tests the tip of each pushed ref in a temporary worktree, plus the corpus when needed. A push takes minutes, so agents run it with a 600000 ms timeout.
- Releases: the `release` skill, only on an explicit request.

Docs, skills, CHANGELOG, release notes and README are in English.
````

- [ ] **Step 6: Check the size.** `wc -c CLAUDE.md` must be ≤ 6000. Tighten wording if needed; never drop a rule.
- [ ] **Step 7: Clause inventory.** For each clause below, grep its new home and tick it. If any is missing, add it before committing.
  - **Old `CLAUDE.md`**, by line:
    - **5:** app summary → `CLAUDE.md` intro; ini uncommitted → skill.
    - **7:** block list → `architecture.md` §2.
    - **8:**
      - style list → `architecture.md` §3;
      - cascade → `CLAUDE.md` + §3;
      - `style-tokens` late-but-works → §3;
      - `.x.hidden` → §3;
      - no `!important` → `CLAUDE.md`.
    - **9:** solver-src, unit-testable globals, `createWorker` prepends, never re-define in `worker-src` → `architecture.md` §4 (+ `CLAUDE.md` short).
    - **10:**
      - `Codecs` interface and stateless → `formats.md`;
      - `PARSERS` order → `formats.md`;
      - registry globals not on `Codecs` → `formats.md`;
      - `validatePlates` runs once → `formats.md`;
      - `parseRules` single parser, reused by `entryToPlates` and hints → `formats.md`;
      - strict rules, null, `|| {}` → `formats.md` (+ `CLAUDE.md`).
    - **11:**
      - pipeline → `db-pipeline.md` + skill;
      - pos 0-based / no clamp → skill "Data model" + `db-pipeline.md` (O5 correction);
      - never hand-edit → `CLAUDE.md` + skill;
      - review:db → skill + `db-pipeline.md`;
      - translation sequence → skill;
      - drops rationale → skill;
      - never edit ini → `CLAUDE.md` + skill;
      - REVIEW-NEEDED → skill;
      - app parsers never read ini → skill + `formats.md`.
    - **12:**
      - sync tool, outputs, R/T/X, weight, abort on mismatch, `--add-missing`, `--write-evidence`, fields, never writes drops → skill + `db-pipeline.md`;
      - ranking, glyph, `#solve-doubt` structural → skill + `db-pipeline.md`;
      - wording rule → `CLAUDE.md` + skill;
      - corpus can't catch wrong variants → skill.
    - **13:** test commands, corpus gate, `CHEST` → `CLAUDE.md` Commands/Testing.
    - **14:** unwinders and their roles, the "five times" history → `architecture.md` §5 (+ `CLAUDE.md` list).
    - **15:** URL clauses → `architecture.md` §6 (+ `CLAUDE.md`).
    - **16:** `render-preview` and its import-dialog use with `findIdenticalChest` → `architecture.md` §7.
    - **17:** `posSetPlateValue` side effects, config A/D, deps ignored at config stage → `architecture.md` §5.
    - **18:** paste inference + contrasts → `formats.md`.
    - **22–53:** selectors, examples, add a test id, language → `CLAUDE.md` Testing.
    - **57–61:** localization incl. the symbol exception and all `i18n.spec` checks → `CLAUDE.md` (short) + `architecture.md` §8.
    - **63–66:** test style incl. the `force` reason → `CLAUDE.md` Testing.
    - **68–74:** gotchas, with the full conditions → `CLAUDE.md` Testing.
  - **README sections:**
    - «Использование» → `user-guide.md` (+ README short);
    - «Нотация ходов», «Форматы конфигурации», «Ограничения» → `formats.md`;
    - «Сложность генерации», «Архитектура» → `architecture.md`;
    - «База данных замков» → `db-pipeline.md` + skill;
    - «Разработка» → README;
    - «Поддержка браузеров» → README.
  - **New rules and their source:**
    - test-id naming → D13;
    - app code never queries by test id → this session's fix;
    - `urlWrite` → D4;
    - i18n attributes → D15;
    - commit types → D1;
    - branch policy → D3;
    - test cadence → D12;
    - drops consent → D16;
    - hedged wording → D18;
    - push timeout → O2.
- [ ] **Step 8: `docs/superpowers/README.md`.** Change "see `README.md`, `CLAUDE.md`, and the code" to "see `CLAUDE.md`, the docs in `docs/` (`architecture.md`, `formats.md`, `db-pipeline.md`, `user-guide.md`), the skills in `.agents/skills/`, and the code".
- [ ] **Step 9: Run** `npx playwright test` and expect a pass.
- [ ] **Step 10: Commit.** In the body, list the factual corrections made while moving text (O5).

```bash
git add CLAUDE.md docs/architecture.md docs/formats.md docs/db-pipeline.md docs/user-guide.md docs/superpowers/README.md
git commit -m "docs: slim CLAUDE.md to rules and pointers; shared reference docs in docs/"
```

---

### Task 8: README for humans (English)

**Files:** Modify `README.md` (full rewrite)

- [ ] **Step 1: Write the new README** in English, following common README practice: short, scannable, the most useful things first. Target ≤ 150 lines. Structure:
  1. `# Gothic Lockpick`: a one-line description, then a link to the live app `https://demetri0.github.io/gothic-lockpick/` (open it once to confirm), then a screenshot (`screenshots/solve.png`; check that it matches today's UI).
  2. `## Features`: 5–7 bullets covering the solver (minimal presses, few plate switches), the 3D view, the chest database with search and live hints, agreement marks (hedged, D18), shareable links, three UI languages, and import/export formats.
  3. `## How to use`: numbered steps (set plate count and positions; set dependencies or find the chest; Solve; step through). A small keyboard table. Links to `docs/user-guide.md` and `docs/formats.md#move-notation`.
  4. `## Chest database`: what it is; where the data comes from (community catalogs, credited with links); that it is third-party data of unknown accuracy (D18); what entries flagged as doubtful look like.
  5. `## Development`: `npm install`, `npm start`, `npx playwright test`, `npm run test:corpus`, `git config core.hooksPath .githooks`. Links to `docs/architecture.md`, `docs/formats.md`, `docs/db-pipeline.md`, and `CLAUDE.md` for AI-agent conventions.
  6. `## Browser support`: a short list, from today's «Поддержка браузеров».

  No Russian, no license section.
- [ ] **Step 2: Coverage check.** For each section of today's README, name where it went: README, a `docs/*.md` file (Task 7), or dropped as obsolete, with the reason. Put the list in the commit body.
- [ ] **Step 3: Commit** `git add README.md && git commit -m "docs(readme): rewrite in English for users; details moved to docs/"`

---

### Task 9: Permissions and ignores

**Files:** Modify `.gitignore`, `.claude/settings.json`, `.claude/settings.local.json` (personal; not committed)

- [ ] **Step 1:** Add to `.gitignore` the lines `main.ts`, `mise.toml` and `.codex/` (D20).
- [ ] **Step 2: Shared allowlist.**
  1. Run the built-in `fewer-permission-prompts` skill. It writes `.claude/settings.json` itself, so review its diff.
  2. Keep only commands that actually prompted, according to the transcripts, and that are trusted test/build execution: `npx playwright test …`, `npm run build:db`, `npm run test:corpus`. Describe them as trusted execution, not "read-only".
  3. Drop git read commands; they are allowed by default. Drop anything that pushes, commits or touches the network.
  4. Merge the result with the Task 2 `deny` rules.
  5. Show the user the final file.
- [ ] **Step 3: Personal file.** Remove `Bash(git commit *)` (D20), `Bash(git init *)` and the one-off `Bash(grep -oP …index.html)`. Show the user the before/after.
- [ ] **Step 4: Commit** `git add .gitignore .claude/settings.json && git commit -m "chore(tooling): ignore personal files; shared allowlist for test/build commands"`

---

### Task 10: Memory (outside the repo)

**Files:** `~/.claude/projects/-home-d3i0-src-gothic-lockpick/memory/`

- [ ] **`project_db_frozen.md`** (keep the filename; inbound links stay valid):
  - Keep verbatim the sentence that the July review-queue leftovers are consciously not to be processed or brought up as pending work, and that `desc` in the UI is not wanted.
  - Replace the old "How to apply" and the "Exception" paragraph with: "Catalog-driven updates (the `update-chest-db` skill) are welcome since 1.6.0. Never drop an entry without asking and explaining why (D16)."
  - Update its `MEMORY.md` line.
- [ ] **`feedback_subagent_explicit_git_add.md`:** keep it, trimmed to the dispatch-specific part. Every subagent/codex brief names the exact `git add <paths>`, and the result is verified with `git show --stat`.
  - Replace the sentence about `main.ts`/`mise.toml` being "untracked-and-not-ignored": they are gitignored now (D20). Broad staging stays wrong anyway.
  - The two inbound references stay valid.
- [ ] **`feedback_skip_tests_for_css.md`:** align it with D12. The suite runs after a meaningful chunk of work or when in doubt, not after every small edit, CSS included. Update the `MEMORY.md` line.
- [ ] **Check:** `grep -rn "sync-lock-catalogs" ~/.claude/projects/-home-d3i0-src-gothic-lockpick/memory/` prints nothing.

---

### Task 11: Finish the branch

- [ ] **CHANGELOG.** Below the intro, above `## [1.6.0]`, write the `[Unreleased]` entry now, so it describes what was actually built:
  - `### Changed`: the GitHub Pages deploy runs on the Node 24 releases of its actions and on the Ubuntu 26.04 LTS runner.
  - `### Documentation`: agent tooling and docs restructured. `CLAUDE.md`/`AGENTS.md` hold rules and pointers; reference docs live in `docs/`; the README is rewritten in English. New: a `release` skill, a pre-commit check that `chests.json` matches a fresh build, a pre-push hook that tests the tip of each pushed ref in a temporary worktree, and a lint for test selectors and URL writes.

  Commit: `git add CHANGELOG.md && git commit -m "docs(changelog): unreleased tooling and CI changes"`.
- [ ] Run `npx playwright test` and expect a full pass. Run `wc -c CLAUDE.md` and expect ≤ 6000. `readlink AGENTS.md` must print `CLAUDE.md`. `git status --short` shows nothing unexpected.
- [ ] **Fresh reviewer:** one fresh reviewer on the most capable model reviews `git diff main...chore/ai-tooling` against this plan. Optionally, codex reviews in parallel as a second seat. Fix confirmed findings in follow-up commits.
- [ ] `git checkout main`. If `main` moved since Task 0, merge it into the branch first and rerun the suite.
- [ ] Run `git merge --no-ff -F <msg-file> chore/ai-tooling`, with the title `Merge: agent tooling and docs restructure`.
- [ ] Ask the user before pushing. The push runs pre-push, so use a 600000 ms timeout. No version bump.

---

### Task 12: Onboarding re-test

**Files:** none in the repo. Session scratchpad:
- `/tmp/claude-1000/-home-d3i0-src-gothic-lockpick/f844d12a-4fa5-4b60-bc42-7431bce4f109/scratchpad/comprehension/questions.md`;
- the private key `…/scratchpad/grading-private/answer-key.md`;
- the baseline grade `…/grading-private/baseline-grade.md`.

- [ ] Run codex again, read-only, with the **identical** `questions.md`, from the merged `main`:

```bash
codex exec -C /home/d3i0/src/gothic-lockpick -s read-only -o <scratchpad>/comprehension/after-answers.md \
  "Read <scratchpad>/comprehension/questions.md and follow it exactly; it is the whole task. Read only the repository and that one file. Work read-only. Your final message must be the complete answers in the requested format." \
  < /dev/null > <scratchpad>/comprehension/after.log 2>&1
```

  The draft-plan exclusion line in `questions.md` stays; the plan is historical by then.
- [ ] Grade it against the private key with the same rubric and compare per question against the baseline (38/44). A drop on any question is a regression: fix the docs and re-run.
- [ ] Separately, outside the comparison, run 4 new questions:
  - (a) what the pre-commit hook checks and how to bypass it deliberately;
  - (b) what pre-push does when you push one commit while other files are uncommitted;
  - (c) how a release is started, and what happens if you only ask "did you tag it?";
  - (d) how to write a new UI label that must survive a language switch.
- [ ] Report the results to the user.

---

### Task 13: Skill trigger evals (last; user asked to return to this)

- [ ] **Isolation, from the reviews:**
  - Make a temporary copy: `git worktree add --detach <scratch>/eval-wt main`, then remove `<scratch>/eval-wt/.claude/skills/<skill>` there, so no real copy competes.
  - Run from the skill-creator directory (`ls -d ~/.claude/skills/synced/*/skill-creator`, or the plugin's `skills/skill-creator`): `cd <skill-creator> && python -m scripts.run_loop --eval-set <abs path> --skill-path <abs path to .agents/skills/<name>> --model claude-opus-5-5 --runs-per-query 1 --max-iterations 3`, with the eval workspace's cwd set to `<scratch>/eval-wt`.
  - Before running, read `scripts/run_eval.py` to confirm how it picks the project root, and adapt.
  - Treat the "test" score as a validation score.
- [ ] **For `update-chest-db` and `release`:** 20 queries each, 8–10 positive and 8–10 near-miss negative. For `release`, status questions ("did you tag it?") are **negatives**, since the description is release-only (O6). Show each set to the user via `assets/eval_review.html` before running.
- [ ] **Commit** the reviewed eval sets in any case (`.agents/skills/<name>/evals/trigger-evals.json`, staged by name). Apply a new description only if it beats the current one, and show the before/after. Remove the eval worktree.

---

## Follow-ups (out of scope, recorded)

- **Critical (D8):** drum paste clamps a digit run that fits neither the 0-based nor the 1-based form (`posReplaceAll`, `index.html` `config` block) instead of rejecting it with a message. Fix it with a test and a 3-locale toast. Also recorded in `docs/formats.md`.
- **License:** the repository has no LICENSE file. `package.json` says `"ISC"`, which is the `npm init` default, not a decision. The user should choose a license and add a `LICENSE` file.
- **CI gate (a separate task later, by the user's decision):** all checks are local and can be bypassed (`--no-verify`, clones without `core.hooksPath`). `.github/workflows/static.yml` deploys on every push to `main` without a test job. Option: a `test` job (suite + pure-node specs) that `deploy` needs.
- **Skill name:** `release` is generic. If a plugin or user skill with the same name ever shadows it, rename it to `release-lockpick`.
