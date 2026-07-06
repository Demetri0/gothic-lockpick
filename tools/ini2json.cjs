#!/usr/bin/env node
'use strict';

const fs = require('fs');

// ── INI value stripper ────────────────────────────────────────────────────────
// Values are wrapped in ""..."" ; last field in a block ends with """ (extra closing ")

function stripVal(raw) {
  const m = raw.match(/^""([\s\S]*?)""["]*$/);
  return m ? m[1].trim() : raw.trim();
}

// ── Section ID extractor ──────────────────────────────────────────────────────
// Handles: [id]  "[id]"  "[""id""]"

function parseSectionId(line) {
  let s = line.trim();
  if (s.startsWith('"')) s = s.slice(1);       // strip outer leading "
  if (!s.startsWith('[')) return null;
  s = s.slice(1).replace(/\]"?\s*$/, '');       // strip [ and trailing ]"
  s = s.replace(/^""(.+?)""$/, '$1');           // strip inner "" wrapping
  return s.trim();
}

// ── INI parser ────────────────────────────────────────────────────────────────

function parseIni(text) {
  const entries = [];
  let cur = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('[') || line.startsWith('"[')) {
      const id = parseSectionId(line);
      if (id !== null) {
        if (cur) entries.push(cur);
        cur = { _sec: id };
        continue;
      }
    }

    if (cur) {
      const eq = line.indexOf('=');
      if (eq > 0 && /^\w+$/.test(line.slice(0, eq))) {
        cur[line.slice(0, eq)] = stripVal(line.slice(eq + 1));
      }
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

// ── pos normalizer ────────────────────────────────────────────────────────────

function normalizePos(raw, cells) {
  if (!raw || !cells) return null;
  const s = raw.trim();

  // No-separator: pure digits, exact length matches cells
  if (/^\d+$/.test(s) && s.length === cells) {
    const arr = s.split('').map(Number);
    if (arr.every(v => v === 0)) return null;
    return arr;
  }

  // Plate:position pairs like "0-3,1-2,2-6" — unrecoverable, skip
  if (/\d+-\d+,\d+-\d+/.test(s)) return null;

  // Unify separators: dots, semicolons, spaces, lone dashes → comma
  const parts = s
    .replace(/[.;\s]/g, ',')
    .replace(/(?<!\d)-(?!\d)/g, ',')  // dashes not between digits → comma
    .split(',')
    .filter(p => p !== '')
    .map(p => Number(p.trim()));

  if (parts.some(isNaN)) return null;
  if (parts.length !== cells) return null;
  if (parts.every(v => v === 0)) return null;  // all-zero placeholder
  if (parts.some(v => v < 0 || v > 6)) return null;  // out of range (positions are 0–6)

  return parts;
}

// ── rules normalizer ──────────────────────────────────────────────────────────

function normalizeRules(raw) {
  if (!raw || !raw.includes(':')) return null;
  return raw
    .toUpperCase()
    .replace(/\s*;\s*/g, ';')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*:\s*/g, ':')
    .replace(/;+$/, '')
    .trim();
}

// ── canonical key ─────────────────────────────────────────────────────────────
// The identity of a lock: positions + the SET of directed dependency edges,
// stable under rule group/token reordering ("B:D-;C:B-" === "C:B-;B:D-").

function rulesEdges(rules) {
  const edges = new Set();
  for (const part of (rules || '').split(';')) {
    const m = part.trim().match(/^([A-H])\s*:\s*(.+)$/i);
    if (!m) continue;
    const from = m[1].toUpperCase().charCodeAt(0) - 64;
    for (const tok of m[2].split(',')) {
      const tm = tok.trim().match(/^([A-H])\s*([+-])$/i);
      if (tm) edges.add(`${from}>${tm[1].toUpperCase().charCodeAt(0) - 64}${tm[2]}`);
    }
  }
  return edges;
}

function canonicalKey(pos, rules) {
  return pos.join(',') + '|' + [...rulesEdges(rules)].sort().join(';');
}

// ── language detector ─────────────────────────────────────────────────────────

function detectLang(text) {
  if (/[іїєґІЇЄҐ]/u.test(text)) return 'uk';
  if (/[а-яёА-ЯЁ]/u.test(text)) return 'ru';
  if (/[äöüßÄÖÜ]/u.test(text) || /\b(lager|mine|kloster|höhle|turm|schiff)\b/i.test(text)) return 'de';
  return 'en';
}

// ── name parser ───────────────────────────────────────────────────────────────
// Handles plain strings and "RU: ""...""; EN: ""...""" multilingual format

const LANG_ALIAS = { ru: 'ru', en: 'en', de: 'de', pl: 'pl', uk: 'uk', ua: 'uk' };

function parseName(raw) {
  if (!raw) return null;

  // "RU: ""value""" / "RU""value""" — colon optional, closing "" optional
  // (closing "" may be consumed by the outer stripVal unwrapping)
  const re1 = /\b(RU|EN|DE|PL|UK|UA)\s*:?\s*""([^""]+?)(?:""[;,\s]*|$)/gi;
  const hits1 = [...raw.matchAll(re1)];
  if (hits1.length) {
    const name = {};
    for (const h of hits1) name[LANG_ALIAS[h[1].toLowerCase()]] = h[2].trim();
    return name;
  }

  // "RU: value" — no double-quote wrapping at all
  const re2 = /^(RU|EN|DE|PL|UK|UA)\s*:\s*(.+)/i;
  const m = raw.match(re2);
  if (m) return { [LANG_ALIAS[m[1].toLowerCase()]]: m[2].trim() };

  const lang = detectLang(raw);
  return { [lang]: raw.trim() };
}

// ── tags parser ───────────────────────────────────────────────────────────────

function parseTags(raw) {
  if (!raw) return [];
  return raw
    .replace(/^(RU|EN|DE|PL|UK)\s*:\s*/i, '')
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

// ── ID generator ──────────────────────────────────────────────────────────────

const MEANINGLESS = new Set(['ru', 'en', 'de', 'pl', 'uk', 'template_chest']);

function isNumericId(s) {
  return s.length < 3 || /^[\d,.\s;-]+$/.test(s);
}

function nameSlug(name) {
  const s = name ? (name.ru || name.en || name.de || Object.values(name)[0] || '') : '';
  return s
    .replace(/[,.()\[\]"'!?:;]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 64);
}

function generateId(sec, name, pos, seen) {
  let base = sec
    .replace(/^(ru|en|de|pl|uk):_?/i, '')
    .replace(/_/g, '-')
    .replace(/[,.()\[\]"'!?]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 64);

  if (MEANINGLESS.has(base) || isNumericId(base)) {
    base = nameSlug(name);
  }

  // Nameless entry → stable content-derived id (section ids on nameless
  // entries are junk more often than not; positions identify the lock)
  if (!Object.keys(name).length || !base) base = 'lock-' + pos.join('');

  let id = base;
  let n = 2;
  while (seen.has(id)) id = `${base}-${n++}`;
  seen.add(id);
  return id;
}

// ── entry transform ───────────────────────────────────────────────────────────

const JUNK_RE = /в_жопу|template/i;

function transform(raw, seen, rep) {
  const sec = raw._sec || '';

  if (JUNK_RE.test(sec)) {
    rep.push(`SKIP junk    [${sec}]`);
    return null;
  }

  const cells = parseInt(raw.cells, 10);
  if (isNaN(cells) || cells < 2 || cells > 8) {
    rep.push(`SKIP cells   [${sec}]  cells=${raw.cells}`);
    return null;
  }

  const rules = normalizeRules(raw.rules);
  if (!rules) {
    rep.push(`SKIP rules   [${sec}]  rules=${raw.rules}`);
    return null;
  }

  const pos = normalizePos(raw.start_pos, cells);
  if (!pos) {
    rep.push(`SKIP pos     [${sec}]  start_pos=${raw.start_pos}`);
    return null;
  }

  // Nameless entries are kept (name {}); the app shows a localized placeholder.
  let name = parseName(raw.name);
  if (!name || !Object.values(name).join('').trim()) name = {};

  const tags = parseTags(raw.tags);
  const id = generateId(sec, name, pos, seen);

  return { id, name, cells, rules, pos, tags, img: [] };
}

// ── decisions layer ("git rerere" for DB curation) ────────────────────────────
// tools/db-decisions.json records every human decision once:
//   overrides    — canonical group → recorded entries (merges, fixes)
//   additions    — entries with no ini counterpart (e.g. future uml imports)
//   translations — per-key name/desc languages (Google-Translate round-trip)

const EMPTY_DECISIONS = { v: 1, overrides: [], additions: [], translations: {} };

function applyDecisions(entries, decisions, rep) {
  const d = { ...EMPTY_DECISIONS, ...(decisions || {}) };
  const overrideByKey = new Map((d.overrides || []).map(o => [o.key, o]));

  // Group parsed entries by canonical key, preserving first-seen order
  const groups = new Map();
  for (const e of entries) {
    const key = canonicalKey(e.pos, e.rules);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const out = [];
  for (const [key, grp] of groups) {
    const ov = overrideByKey.get(key);
    if (ov) {
      out.push(...ov.entries.map(e => ({ ...e })));
      rep.push(`OVERRIDE     [${key}] ${grp.length} entr${grp.length === 1 ? 'y' : 'ies'} → ${ov.entries.length}`);
      // A frozen-but-unmerged group is still a dedup candidate
      if (ov.entries.length > 1) {
        rep.push(`REVIEW-NEEDED [${key}] ${ov.entries.length} duplicates (overridden): ${ov.entries.map(e => e.id).join(', ')}`);
      }
    } else {
      out.push(...grp);
      if (grp.length > 1) {
        rep.push(`REVIEW-NEEDED [${key}] ${grp.length} duplicates: ${grp.map(e => e.id).join(', ')} — run the dedup review`);
      }
    }
  }

  for (const add of d.additions || []) {
    out.push({ ...add });
    rep.push(`ADDITION     [${add.id}]`);
  }

  // Translations FILL missing name/desc languages by canonical key — they never
  // overwrite an explicit value (ini names, override merges, AI-fixed texts all
  // rank above a machine translation). `byId` addresses one entry of an unmerged
  // duplicate group; the plain form applies to every entry with the key.
  const tr = d.translations || {};
  const fill = (target, add) => {
    if (!add) return target;
    const out2 = { ...target };
    for (const [lang, text] of Object.entries(add)) {
      if (!out2[lang]) out2[lang] = text;
    }
    return out2;
  };
  for (const e of out) {
    const t = tr[canonicalKey(e.pos, e.rules)];
    if (!t) continue;
    const parts = [t.byId && t.byId[e.id], t].filter(Boolean); // specific first
    for (const p of parts) {
      if (p.name) e.name = fill(e.name, p.name);
      if (p.desc) e.desc = fill(e.desc || {}, p.desc);
    }
  }

  return out;
}

// ── public API ────────────────────────────────────────────────────────────────

/** Full pipeline: ini text (+ decisions) → { entries, report }. */
function buildEntries(iniText, decisions) {
  const rep = [];
  const seen = new Set();
  const parsed = parseIni(iniText).map(r => transform(r, seen, rep)).filter(Boolean);
  const entries = applyDecisions(parsed, decisions, rep);
  return { entries, report: rep };
}

module.exports = {
  parseIni, transform, buildEntries, applyDecisions,
  canonicalKey, rulesEdges, normalizeRules, normalizePos, parseName, parseTags,
};

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const [,, iniPath = 'chests.ini', outPath = 'chests.json',
         repPath = 'chests-report.txt', decisionsPath = 'tools/db-decisions.json'] = process.argv;

  const src = fs.readFileSync(iniPath, 'utf8');
  const decisions = fs.existsSync(decisionsPath)
    ? JSON.parse(fs.readFileSync(decisionsPath, 'utf8'))
    : null;

  const { entries, report } = buildEntries(src, decisions);

  const output = { v: 1, updated: new Date().toISOString(), entries };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  fs.writeFileSync(repPath, report.join('\n') + '\n', 'utf8');

  const count = p => report.filter(l => l.startsWith(p)).length;
  process.stderr.write(
    `Entries: ${entries.length}\n` +
    `Skipped: ${count('SKIP')}  Overrides: ${count('OVERRIDE')}  ` +
    `Additions: ${count('ADDITION')}  Review-needed: ${count('REVIEW-NEEDED')}\n` +
    `Output : ${outPath}\nReport : ${repPath}\n` +
    (decisions ? `Decisions: ${decisionsPath}\n` : `Decisions: none (${decisionsPath} not found)\n`)
  );
}
