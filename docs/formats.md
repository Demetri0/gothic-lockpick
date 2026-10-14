# Config formats and position input

How a lock configuration is written, imported, exported and typed in. Architecture: [architecture.md](architecture.md).

## The model

A lock has 2–8 plates on a line of exactly 7 positions (holes). Each plate moves left or right. Dependencies link plates: moving one drags the linked plates by the given steps in the same or the opposite direction. Dependencies are **not transitive**: with A→B and B→C, moving A moves only B, and C reacts only when B is moved directly. Cycles (A→B and B→A) are allowed: a move applies only the moved plate's own dependencies, so there is no chain to follow. The goal is all plates in the center position at once.

## Move notation

```
<plate id><direction><steps>
```

- `A` = left, `D` = right.
- Steps are omitted when equal to `1`.

Examples: `1A`, `2D3`, `7A2`. Consecutive moves of one plate in one direction are compressed: `1A 1A 1A` → `1A3`.

## Codec registry

Import/export goes through the codec registry in the `codecs` block.

- **The four codecs** live under the `Codecs` namespace: `Codecs.gothic`, `Codecs.json`, `Codecs.dotted` and `Codecs.bytearray`.
- **Each codec** is a self-contained, stateless object: `{ id, parse(str) → plates|null, serialize(plates) → string|null }`. Neither method throws; `null` means "not this format" or "not representable".
- **The registry and facade** are module-level globals, not members of `Codecs`:
  - `PARSERS` is the ordered codec list;
  - `parseConfig()` and `looksLikeImportConfig()` form the facade;
  - `validatePlates()` checks the universal invariants once, inside `parseConfig`.
- **Adding a format** means a new `Codecs` codec **and** an entry in the `PARSERS` order. Never special-case a format inline in the import handler.
- **`Codecs.gothic.parseRules`** is the single rule-string parser, reused by `entryToPlates` and the hint renderer. It is whitespace and case tolerant but **strict on content**. A token that isn't a rule at all (no `X:` source with targets, e.g. a stray positions run) is ignored. Inside a rule, though, every dependency must state a direction (`+`/`-`), since there is no third kind: a direction-less or malformed dependency makes the whole parse invalid (`null`), never a silent drop. Consumers guard the `null` with `|| {}`.
- **INI syntax** (`start_pos=`, `rules=`, INI keys) is never read by the app's parsers. INI parsing is DB-pipeline-only (`tools/ini2json.cjs`).

`Ctrl+C` and the export button copy gothic; `Shift`+click the export button for JSON.

## Import behavior

A config is never overwritten silently:

- **`Ctrl+V` opens a confirmation dialog.** It previews the lock (positions plus dependency matrix) and, if the database holds the same lock, shows a card for it. Text that doesn't look like a config is ignored, without a "wrong format" message.
- **Pasting into the position drum is about digits.** A full config in the clipboard is applied whole only when the matrix is empty (no dependencies). Otherwise only the digits are taken, and a toast says the config was not applied.
- **Out-of-range positions in a config are never adjusted one by one.** The codecs shift the whole run or reject it; otherwise the result would be a config the user never entered.

## JSON

```json
[
  { "id": 1, "positions": 7, "currentPos": 3,
    "deps": [ { "targetId": 2, "direction": "same", "steps": 1 } ] },
  { "id": 2, "positions": 7, "currentPos": 5, "deps": [] }
]
```

- **`positions`:** exactly 7 for every plate. The app is fixed at 7 holes by decision.
- **`currentPos`:** 1..7. 1 is the leftmost **hole** of the plate, i.e. the plate itself sits furthest right; 7 is the rightmost hole, with the plate furthest left.
- **`id`:** exactly the sequence `1..N`.
- **`deps.direction`:** `"same"` or `"opposite"`.
- **`deps.steps`:** an integer from 1 to 6 (`positions − 1`; a longer step can never be legal). The UI edits only `1`; larger steps come only from import.
- **Self-dependencies** (`targetId === id`) are not allowed.

## gothic — `positions + rules`

A compact string such as `040615 A:B-,C+;D:E-`: position digits (0-based) and rules, in any order. Both parts are required. `+` = `same`, `-` = `opposite`; letters `A..H` → plates `1..8`.

"gothic" is the project's own name for this notation. It is **not** the game's format or an export from it; only the chest database data came from Gothic 1 Remake.

## dotted — `N.positions.pairs`

For example `3.531.saaoaa`: `N` plates, one position digit per plate (0-based), then one character per ordered pair (from-major, self skipped). `s` = same, `o` = opposite, `a` = no link. This is the format of `?lock=` links.

## byte-array (unlockmyloot v2)

A compact base64url code, the value of the `lock` parameter in an unlockmyloot link. Paste the code itself, not the whole URL. It is canonical: fixed lengths and zero pad bits. This format is import-only.

## Typing positions into the drum

The position drum shows 1-based values (1..7). Every wire format (gothic, dotted, DB `pos`) is 0-based.

- **A single digit** (typed, or a one-character paste) is always the displayed 1-based value.
- **A multi-digit paste** replaces the whole set, and its base is inferred from the digits (`posReplaceAll`):
  - a run containing `0` is read as 0-based (0..6);
  - otherwise it is read as the displayed 1-based values.

  So `0123` sets 1,2,3,4 and `1234` sets 1,2,3,4. A run of digits 1–6 only is ambiguous and reads as 1-based: the drum sets the values it shows.

> **Known issue (critical, to fix):** a pasted run that fits neither form, such as `07` (contains both `0` and `7`) or one with `8`/`9`, is clamped digit by digit instead of rejected: `07` → 1,7, `89` → 7,7. The intended behavior is to reject the whole run with a message, as the codecs already do for out-of-range runs.

Compare the other two places that read positions:
- the DB **position search** is a matcher, so it tries both readings (`searchByPosition`);
- the **chest-hint matcher** is deterministically 0-based by design.
