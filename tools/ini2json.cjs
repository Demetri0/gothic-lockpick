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

function generateId(sec, name, seen) {
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

  if (!base) base = 'chest';

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

  const name = parseName(raw.name);
  if (!name || !Object.values(name).join('').trim()) {
    rep.push(`SKIP name    [${sec}]`);
    return null;
  }

  const tags = parseTags(raw.tags);
  const id = generateId(sec, name, seen);

  return { id, name, cells, rules, pos, tags, img: [] };
}

// ── deduplication ─────────────────────────────────────────────────────────────

function deduplicate(entries, rep) {
  const groups = new Map();
  for (const e of entries) {
    const key = `${e.rules}|${e.pos.join(',')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const out = [];
  for (const [, grp] of groups) {
    if (grp.length === 1) { out.push(grp[0]); continue; }

    // Keep entry with longest name + most tags
    const best = grp.reduce((a, b) => {
      const sa = Object.values(a.name).join('').length + a.tags.length * 10;
      const sb = Object.values(b.name).join('').length + b.tags.length * 10;
      return sb > sa ? b : a;
    });
    out.push(best);
    for (const e of grp) {
      if (e !== best) rep.push(`DEDUP        [${e.id}] → [${best.id}]`);
    }
  }
  return out;
}

// ── main ──────────────────────────────────────────────────────────────────────

const [,, iniPath = 'chests.ini', outPath = 'chests.json', repPath = 'chests-report.txt'] = process.argv;

const src = fs.readFileSync(iniPath, 'utf8');
const raw = parseIni(src);

const rep = [];
const seen = new Set();
const entries = raw.map(r => transform(r, seen, rep)).filter(Boolean);
const deduped = deduplicate(entries, rep);

const output = { v: 1, updated: new Date().toISOString(), entries: deduped };
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
fs.writeFileSync(repPath, rep.join('\n') + '\n', 'utf8');

const skipped  = rep.filter(l => l.startsWith('SKIP')).length;
const duped    = rep.filter(l => l.startsWith('DEDUP')).length;
process.stderr.write(
  `Raw: ${raw.length}  →  valid: ${entries.length}  →  after dedup: ${deduped.length}\n` +
  `Skipped: ${skipped}  Deduplicated: ${duped}\n` +
  `Output : ${outPath}\n` +
  `Report : ${repPath}\n`
);
