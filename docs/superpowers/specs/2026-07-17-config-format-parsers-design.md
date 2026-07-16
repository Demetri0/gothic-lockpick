# Config Format Parsers — Design

## Goal

Refactor config import/export in `index.html` from ad-hoc try/catch parsing into a set of self-contained **format parser units**, and add two new formats. Each unit knows how to (a) turn the internal state into a string and (b) turn a string back into state, recognising whether a given string is its format. This also produces the string codecs that the URL-persist (#8) and Share (#11) features will consume.

## Canonical internal state

The single source of truth every parser converts to/from is the `plates` array:

```js
{ id: number,               // 1..N, contiguous
  positions: number,        // hole count, odd, >= 3 (app default 7)
  currentPos: number,       // 1-based, 1..positions
  deps: [ { targetId: number,          // 1..N, != id
            direction: 'same'|'opposite',
            steps: number } ] }         // >= 1 (always 1 for these formats)
```

## Parser unit interface

Each parser is a plain **stateless object** (no classes — nothing to instantiate):

```js
{
  id: 'json' | 'gothic' | 'dotted' | 'bytearray',
  parse(str) -> plates | null,   // null  = "not my format" (cheap shape-guard failed)
                                 // plates = decoded (format-level) config
                                 // Full universal validation is NOT done here.
  serialize(plates) -> string | null,  // inverse of parse; null = this state is
                                        // not representable in this format
}
```

There is **no separate public `detect`**: "does this string belong to me?" is exactly the `null` branch of `parse`. Because the four formats are structurally disjoint (see Detection), at most one parser returns non-null for any string, so ordering is unambiguous.

**Contract — no exceptions in the happy path.** Both `parse` and `serialize` signal "can't" by returning `null`, never by throwing. `parse` returns `null` when the string isn't this format (or is a malformed instance of it); `serialize` returns `null` when the state can't be expressed in this format (only `bytearray` with `< 3` plates does this today). Callers therefore branch on `null` and never need `try/catch`. (A parser implementation may still internally guard against a genuine programmer error, but that is not part of this contract.)

### Shared validation

Universal invariants live in **one** function, run once by the registry after a parser decodes:

```js
validatePlates(plates) -> plates | null
```

Checks: `Array.isArray`, `2 <= length <= 8`, ids are exactly `1..N`, all `positions` equal + odd + `>= 3`, `1 <= currentPos <= positions`, each dep `{ targetId in 1..N, targetId != id, direction in {same,opposite}, steps integer >= 1 }`. Returns the array unchanged if valid, else `null`. (This is today's `parseImportConfig` validation block, extracted.)

### Registry

```js
const PARSERS = [json, dotted, gothic, bytearray];

function parseConfig(str) {                     // replaces parseImportConfig
  const text = String(str).trim();
  for (const p of PARSERS) {
    const plates = p.parse(text);               // never throws (contract): null if not this format
    if (plates) { const v = validatePlates(plates); if (v) return v; }
  }
  return null;                                  // unrecognised -> caller shows "invalid config"
}
```

`looksLikeImportConfig(text)` (the paste auto-import heuristic) becomes a thin reuse of the registry — a paste auto-imports iff it parses to a fully valid config:

```js
function looksLikeImportConfig(text) {
  return parseConfig(text) !== null;
}
```

All four formats participate, **including `bytearray`**, so pasting a bare share code just imports. The reason this is safe for `bytearray` — despite it being punctuation-free and thus superficially similar to ordinary alphanumeric text — is its **canonical shape guard** (see the format section): the string length must be exactly one of the valid per-`N` lengths, the trailing pad bits must be zero, and it must decode to an in-range config. A random alphanumeric paste satisfying all of those simultaneously is far below 0.1%, so spurious import dialogs are not a real concern.

## Formats

### 1. `json`

- **shape guard:** trimmed starts with `[` or `{`.
- **parse:** `JSON.parse`; on syntax error return `null`. Return the parsed value as-is (registry's `validatePlates` rejects non-conforming JSON). Accepts the export shape `[{id,positions,currentPos,deps}]`.
- **serialize:** `JSON.stringify(plates.map(({id,positions,currentPos,deps}) => ({id,positions,currentPos,deps})))` (today's Shift-export).

### 2. `gothic`

Represents **positions + dependencies together** as one line, e.g. `"040615 A:B-,C+;D:E-"`. ("gothic" is just this project's conventional name for the notation — a label that stuck; it is **not** an actual in-game / game-exported format.) Requires *both* positions and rules — bare positions and rules-only are no longer gothic-import cases.

**The parser knows nothing about `chests.ini`.** It parses exactly the compact `positions + rules` notation — no `rules=` / `start_pos=` / `cells=` / `name=` / `tags=` keys, no INI entries. INI parsing belongs to the DB pipeline (`tools/ini2json.cjs`, Node) and is out of scope for the app. The current `parseGothicFormat`'s INI-key handling is **removed**.

- **format:** `<positions> <rules>` in either order, e.g. `040615 A:B-,C+;D:E-` or `A:B-,C+;D:E- 040615`. Positions = one **0-based** digit per plate (`0..6` → `currentPos 1..7`); rules = `SRC:TGT±[,TGT±…][;SRC:…]` where letters `A..H` → ids `1..8`, `+`=`same`, `-`=`opposite`. Lenient about surrounding whitespace, letter case, and the positions/rules order; strict only in requiring **both** parts. Hole count assumed **7**.
- **shape guard:** the string must contain a positions digit-run (`\d{2,8}`) **and** at least one rule token `([A-H])\s*:\s*[A-H]\s*[+-]` (case-insensitive). If either is absent → `null`.
- **parse:** extract the digit-run as positions and the rule tokens as deps; build plates. Reuses `parseRules` (below) for the rule half.
- **`parseRules(str) -> { A:[{targetId,direction,steps}], … }`** — extracted public helper that parses only the rule half (`A:B-,C+;D:E-` → per-source dep lists). `gothic.parse` calls it internally; it is also the public entry point for rules-only parsing (manual/edge use). The one existing rules-only test (`import.spec.js:221`) moves onto `parseRules`.
- **serialize:** existing `serializeGothicFormat` (positions + `A:B±;…`). Unchanged (always returns a string).
- **Known limitation:** a dependency-less config serialises to bare positions, which `gothic.parse` will not re-import (it needs rules). A lock with no dependencies is a degenerate case (nothing to solve), so it is not special-cased — such a config can still round-trip via json/dotted.
- **Migration:** the INI-entry tests in `tests/import.spec.js` (those feeding `rules=`/`start_pos=`/full-INI strings) are removed — that capability leaves the app. The compact `positions rules` import/export tests stay.

### 3. `dotted`  —  `N.positions.pairs`

Human-inspectable compact format. Example `3.531.saaoaa`, `7.5313505.ss…so`.

- `N` = plate count (`2..8`). Redundant with `positions.length`; used as a validator.
- `positions` = one **0-based** digit per plate (`0..6` for 7 holes) → `currentPos = digit + 1`.
- `pairs` = one char per **ordered pair** `(from, to)`, `from != to`, **from-major** order (all of A's targets B,C,…; then B's targets A,C,…). Length must equal `N*(N-1)`. Alphabet: **`s`=same(+), `o`=opposite(−), `a`=absent**.
- **shape guard:** `/^(\d+)\.(\d+)\.([sao]+)$/i`. If no match → `null`.
- **parse:** validate `N === positions.length` and `pairs.length === N*(N-1)`; on mismatch → `null` (registry reports invalid). Build deps: for from-index i, to-index j (j≠i), read next char; `s`/`o` → add dep `{targetId:j+1, direction, steps:1}`.
- **serialize:** `N` + `.` + positions(0-based) + `.` + pairs from-major; `a` where no dep, `s`/`o` per direction. Hole count assumed 7 (positions 0-6).

### 4. `bytearray`  —  unlockmyloot `?lock=` v2

Compact base64url bitstream; **byte-for-byte compatible with unlockmyloot lock codes** (their share links import directly). We already have the decoder in `tools/sync-uml.cjs::decodeLockCode`; port it into `index.html` and add the matching encoder.

- **alphabet:** `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_` (6 bits/char, MSB-first).
- **bit layout:** `3b` = `plateCount − 3`; `1b` = display-flip (we **write 0, ignore on read**); then `3b` per plate = pin `currentPos−1` (0-based); then `2b` per ordered pair `(i,j)`, `i!=j`, from-major = `0` none / `1` same / `2` opposite.
- Bits for N plates: `4 + 3N + 2·N·(N−1)`; final char zero-padded.
- **shape guard (canonical):** `/^[A-Za-z0-9_-]+$/` **and not** `/^\d+$/` **and** `str.length` is exactly one of the valid per-`N` lengths **{5, 7, 10, 14, 19, 24}** (N=3..8) **and** it decodes without running out of bits **and** the trailing pad bits (unused bits of the last char) are all zero. If any fails → `null`. This canonicity is what makes `bytearray` safe to auto-detect from a bare paste (a random alphanumeric string clearing all of these is <0.1%). Valid lengths derive from `ceil((4 + 3N + 2·N·(N−1)) / 6)`.
- **parse:** decode `n`, skip flip, read pins, read pairs; build plates (`positions:7`). `n` range `3..8` after the `+3` (byte-array cannot represent a **2-plate** config — see constraints).
- **serialize:** inverse; **returns `null` for `n < 3`** (a 2-plate config is not representable — caller falls back to another format). Otherwise: write `n−3`, flip `0`, pins `currentPos−1`, pairs from-major from deps, then pack 6-bit groups into base64url with zero padding. Always canonical (minimal length, zero pad), so `parse(serialize(x))` round-trips.

## Detection / precedence

Formats are disjoint, so precedence only matters for early-exit efficiency:

| Format | Signature (mutually exclusive) |
|---|---|
| json | starts `[`/`{` |
| dotted | `\d+\.\d+\.[sao]+` (has dots) |
| gothic | a digit-run **and** a `:` rule token (base64url has no `:`) |
| bytearray | pure base64url, has a non-digit, decodes |

A full gothic string contains `:` `;` `+` space → not base64url → never claimed by bytearray. A base64url blob has no `:` → never claimed by gothic. Bare digits (`"3055665"`) match none (gothic needs rules; bytearray excludes pure-digits) → not an import config, consistent with the drum-input path being separate.

Registry order: `[json, dotted, gothic, bytearray]`.

## Constraints & edge cases (documented, not bugs)

- **2-plate configs** are representable by json/gothic/dotted but **not bytearray** (v2 min plateCount is 3). `bytearray.serialize` refuses `n < 3`.
- **Non-7 hole counts**: dotted (single digit) and bytearray (3-bit pin, 0..7) assume the app's 7 holes. A JSON config with `positions != 7` round-trips only through json/gothic, not dotted/bytearray.
- **flip bit**: read-ignored, written 0 — cosmetic in unlockmyloot, irrelevant to lock physics.
- **Bare digits** never reach `parseConfig` through the normal paste flow (auto-import heuristic), and are excluded by every parser's shape guard anyway.

## Scope boundary

**In scope:** the four parser units (`parse`+`serialize`), `validatePlates`, `parseConfig`, the `looksLikeImportConfig` rewrite, and paste auto-import of **all four** formats (byte-array included, guarded by its canonical shape check).

**Out of scope (separate follow-ups):** exposing the new formats in the export/copy UI, and URL-persist (#8) / Share button (#11) wiring. Those consume the serializers this feature produces; export UI stays gothic + JSON for now.

## Testing

New `tests/config-parsers.spec.js`, plus migration edits to `tests/import.spec.js`. Coverage is deliberately dense: every parser gets multiple valid vectors, multiple invalid vectors for **each** structural mismatch, and the routing matrix gets many near-miss cases. Concrete cases below (each `-` is at least one test; group by `describe`).

### A. Known decode vectors (exact expected state)

- **dotted** `3.531.saaoaa` → 3 plates, `currentPos [6,4,2]`, deps `A:B+ ; B:C−`, nothing else.
- **dotted** `7.5313505.<pairs>` (the 7-plate example) → 7 plates, `currentPos [6,4,2,4,6,1,6]`, deps as decoded.
- **gothic** `040615 A:B-,C+;D:E-` → 6 plates, `currentPos [1,5,1,7,2,6]`, deps `A:B− ,C+ ; D:E−`.
- **gothic** order-swapped `A:B-,C+;D:E- 040615` → same state as above.
- **bytearray** — reuse a real unlockmyloot v2 code from `sync-uml`/`reference-configs` fixtures; decodes to its published `pos`+`rules`.
- **json** — the export array shape decodes to the same object.

### B. Per-parser round-trip (`parse(serialize(state)) deep-equals state`)

For each reference config (all have deps), and separately for a small hand-built config:
- json: round-trips for any valid state incl. `positions != 7` and 2-plate.
- gothic: round-trips for configs **with deps** (dep-less serialises to bare positions → not re-importable, asserted separately).
- dotted: round-trips for 2–8 plates, 7 holes; also `serialize` then `parse` equals input, and `parse` then `serialize` equals the canonical string.
- bytearray: round-trips for 3–8 plates; the produced string is canonical (asserted: minimal length + zero pad); `serialize` of a 2-plate config returns `null`.

### C. Per-parser invalid-format vectors (each returns `null`, one test per mismatch)

- **json:** not `[`/`{` (→ null, i.e. "not mine"); starts `[` but broken JSON; valid JSON that isn't a plates array (number, object, wrong keys); array of non-conforming plate objects.
- **gothic:** positions only (`040615`); rules only (`A:B-;D:E-`); rule token with an out-of-range letter/sign; positions present but no rule token; empty/whitespace.
- **dotted:** wrong dot count (`3.531`, `3.531.saa.oo`); `N` ≠ positions length (`3.5313.saaoaa`); pairs length ≠ `N*(N-1)` (`3.531.saaoa`, `3.531.saaoaaa`); illegal pair char (`3.531.saaox`); non-digit in `N`/positions; empty pairs.
- **bytearray:** wrong length (not in `{5,7,10,14,19,24}`); valid length but non-zero pad bits; contains a non-base64url char; pure digits `3055665`; decodes to `plateCount > 8`; decodes to a pin `> 6` (out of the 7-hole range → rejected by `validatePlates`).
- **validatePlates (via any parser output):** ids not `1..N` / gap; even `positions`; `positions < 3`; unequal `positions` across plates; `currentPos` `0` or `> positions`; self-dep (`targetId == id`); `targetId` out of range; bad `direction`; `steps < 1` / non-integer; `length < 2` or `> 8`.

### D. Routing matrix (`parseConfig` / detection chain)

- Each format's canonical string routes to and is accepted by **its** parser and produces the right config (positive routing).
- Each format's string is rejected (`parse` → null) by the **other three** parsers (disjointness) — a table test over all 4×3 pairs.
- **Near-miss non-routing (many cases):** strings that resemble a format but are structurally invalid must NOT be silently claimed by a *different* parser — they must end at `parseConfig` → `null`, not an accidental import. E.g.:
  - `3.531.saax` (broken dotted) → not claimed by gothic/bytearray/json → null.
  - `040615` (bare positions) → null (not gothic without rules; not bytearray — pure digits; not dotted; not json).
  - `A:B-;D:E-` (bare rules) → null.
  - a base64url blob one char short/long of a valid length → null (not mis-read as gothic/dotted).
  - `[1,2,3]` (valid JSON, invalid config) → null.
  - random word `"hello"` / `"config"` → null (not a false-positive bytearray).
- `looksLikeImportConfig(text) === (parseConfig(text) !== null)` holds for the whole matrix (auto-import fires iff a valid config is recognised).

### E. Migration

- The rules-only test (`import.spec.js:221`) moves onto `parseRules`.
- INI-entry tests in `import.spec.js` (feeding `rules=`/`start_pos=`/full-INI strings) are **deleted** — capability removed from the app.
- Existing compact `positions rules` import/export tests and the `reference-configs`/`startSolve` flows keep passing unchanged.
