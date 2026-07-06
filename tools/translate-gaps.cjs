#!/usr/bin/env node
'use strict';

// Google-Translate round-trip for missing DB languages (ru/en/de/uk).
//
//   --export                    gaps-<lang>.txt (one text per line, paste into
//                               Google Translate) + gaps-<lang>.map.json
//   --import <lang> [file]      zip translated lines back via the map into
//                               db-decisions translationsPending (staging)
//   --finalize                  staging → translations (run AFTER the AI
//                               verification pass over the imported texts)
//
// Files live in tools/gaps/ (gitignored). Translations are fill-only at build
// time, so a machine translation never overwrites an explicit name.

const fs = require('fs');
const path = require('path');
const { canonicalKey } = require('./ini2json.cjs');

const LANGS = ['ru', 'en', 'de', 'uk'];
const SRC_PRIORITY = ['ru', 'en', 'de', 'uk'];

/** Pick the best available source language of a {lang: text} object. */
function pickSrc(obj) {
  for (const lang of SRC_PRIORITY) if (obj[lang]) return lang;
  return null;
}

/**
 * Collect per-language gap lines + parallel maps from built entries.
 * @returns {{ [lang]: { lines: string[], map: Array<{key,id,field,src}> } }}
 */
function exportGaps(entries) {
  const out = Object.fromEntries(LANGS.map(l => [l, { lines: [], map: [] }]));
  for (const e of entries) {
    const key = canonicalKey(e.pos, e.rules);
    for (const field of ['name', 'desc']) {
      const obj = e[field];
      if (!obj) continue;
      const src = pickSrc(obj);
      if (!src) continue;  // nothing to translate from (e.g. nameless entry)
      for (const lang of LANGS) {
        if (obj[lang]) continue;
        out[lang].lines.push(obj[src]);
        out[lang].map.push({ key, id: e.id, field, src });
      }
    }
  }
  return out;
}

/** Zip translated lines back into decisions.translationsPending (staging). */
function importGaps(decisions, lang, lines, map) {
  if (lines.length !== map.length) {
    throw new Error(`line count mismatch: ${lines.length} translated lines vs ${map.length} map rows`);
  }
  const pending = decisions.translationsPending = decisions.translationsPending || {};
  for (let i = 0; i < map.length; i++) {
    const { key, id, field } = map[i];
    const text = lines[i].trim();
    if (!text) continue;
    const k = pending[key] = pending[key] || {};
    const byId = k.byId = k.byId || {};
    const ent = byId[id] = byId[id] || {};
    const f = ent[field] = ent[field] || {};
    f[lang] = text;
  }
  return decisions;
}

/** Deep-merge staging into translations, clear staging. */
function finalizeTranslations(decisions) {
  const pending = decisions.translationsPending || {};
  const tr = decisions.translations = decisions.translations || {};
  const merge = (dst, src) => {
    for (const [k, v] of Object.entries(src)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        dst[k] = merge(dst[k] && typeof dst[k] === 'object' ? dst[k] : {}, v);
      } else if (dst[k] === undefined) {
        dst[k] = v;
      } else {
        dst[k] = v; // pending is newer (post-AI-verification) — it wins
      }
    }
    return dst;
  };
  merge(tr, pending);
  delete decisions.translationsPending;
  return decisions;
}

module.exports = { exportGaps, importGaps, finalizeTranslations, LANGS };

// ── CLI ───────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const GAPS_DIR = path.join(__dirname, 'gaps');
  const DECISIONS = path.join(__dirname, 'db-decisions.json');
  const [,, cmd, ...rest] = process.argv;

  const loadDecisions = () => JSON.parse(fs.readFileSync(DECISIONS, 'utf8'));
  const saveDecisions = (d) => fs.writeFileSync(DECISIONS, JSON.stringify(d, null, 2), 'utf8');

  if (cmd === '--export') {
    const entries = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'chests.json'), 'utf8')).entries;
    fs.mkdirSync(GAPS_DIR, { recursive: true });
    const out = exportGaps(entries);
    for (const lang of LANGS) {
      const { lines, map } = out[lang];
      if (!lines.length) { process.stderr.write(`${lang}: nothing missing\n`); continue; }
      fs.writeFileSync(path.join(GAPS_DIR, `gaps-${lang}.txt`), lines.join('\n') + '\n', 'utf8');
      fs.writeFileSync(path.join(GAPS_DIR, `gaps-${lang}.map.json`), JSON.stringify(map, null, 2), 'utf8');
      process.stderr.write(`${lang}: ${lines.length} lines → tools/gaps/gaps-${lang}.txt (translate to «${lang}», save as gaps-${lang}.translated.txt)\n`);
    }
  } else if (cmd === '--import') {
    const [lang, file] = rest;
    if (!LANGS.includes(lang)) { process.stderr.write(`usage: --import <${LANGS.join('|')}> [file]\n`); process.exit(1); }
    const src = file || path.join(GAPS_DIR, `gaps-${lang}.translated.txt`);
    const lines = fs.readFileSync(src, 'utf8').replace(/\n+$/, '').split('\n');
    const map = JSON.parse(fs.readFileSync(path.join(GAPS_DIR, `gaps-${lang}.map.json`), 'utf8'));
    const d = loadDecisions();
    importGaps(d, lang, lines, map);
    saveDecisions(d);
    process.stderr.write(`${lang}: staged ${lines.filter(l => l.trim()).length} translations (translationsPending). Run the AI verification pass, then --finalize.\n`);
  } else if (cmd === '--finalize') {
    const d = loadDecisions();
    const pendingCount = Object.keys(d.translationsPending || {}).length;
    finalizeTranslations(d);
    saveDecisions(d);
    process.stderr.write(`Finalized ${pendingCount} keys into translations. Rebuild with: npm run build:db\n`);
  } else {
    process.stderr.write('usage: translate-gaps.cjs --export | --import <lang> [file] | --finalize\n');
    process.exit(1);
  }
}
