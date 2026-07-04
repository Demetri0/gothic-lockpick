# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-07-04

### Added
- **Live chest-match hints** on the config stage. As you enter disc positions, a
  row of real Gothic 1 Remake chest cards appears between the position lock and the
  dependency matrix, matched to the current positions by a left prefix. Clicking a
  card applies that chest's full configuration (positions **and** dependency rules).
- **Combined match score** driving inclusion, ranking, and card brightness:
  `score = prefix · (0.7 + 0.3 · count)`, multiplicative so a chest with no
  positional overlap never surfaces. Entries below `0.25` are dropped; a full match
  jumps to full opacity while partials share a lower band, so the gap above a full
  match is larger than the gaps among partials.
- **Green highlight** of the discs in a hint preview that coincide with the user's
  positions.
- **Dependency-aware ranking.** Once the matrix has entered dependencies, they
  modulate the score — matching edge `+0.5`, missing `−0.2`, opposite-direction
  conflict `−1.5` (clamped `≥ 0`). An empty matrix has no effect.
- **Colored rules line** on each hint card showing the chest's rules in gothic
  format (`A:B-,C+;D:E-`), with tokens green when they match an entered dependency
  and red when they conflict.
- **Full-name tooltip** (`title`) on hint cards, since the name/tags are
  ellipsis-truncated in the UI.
- **Mouse-wheel inc/dec** over a position digit — scrolling up/down nudges that
  plate's position by `±1`, like its `+/−` buttons.

### Changed
- Hint cards reflow to name + tags on the left, disc preview on the right, capped
  at 3 cards. The visible count follows the **container (panel) width** via CSS
  container queries — not the viewport — so a narrow config panel shows fewer cards
  even on a wide screen.
- All single-plate position edits (typing, `+/−`, arrow keys, wheel, 3D hole
  clicks) now route through one `posSetPlateValue` entry point, keeping the cached
  solution, input sync, 3D scene, and hint refresh in one place.

### Fixed
- Clicking a hole in the 3D preview now refreshes the hints (previously that path
  bypassed the hint update).
- Hints degrade silently when `chests.json` fails to load (offline / fetch error) —
  no errors, the container just stays hidden.

### Documentation
- Rewrote the stale position-input section of the README (combination lock + mouse
  wheel), added a "Подсказки-совпадения" section, and refreshed the architecture
  script list. Recorded the single-position-setter convention in `CLAUDE.md`.
