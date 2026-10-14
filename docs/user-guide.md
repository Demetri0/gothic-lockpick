# User guide

How to use Gothic Lockpick. Move notation and import formats: [formats.md](formats.md).

## Interface language

Three flag buttons in the top-right corner switch between Русский, Українська and English. The choice is saved in `localStorage`.

## Configuration screen

| Control | Action |
|---|---|
| **Random: 🟢 🟡 🔴** | A random lock: easy / medium / hard |
| **📤** | Copy the config to the clipboard |
| **📥** | Import a config from the clipboard |
| **Ctrl+C** | Copy the current config |
| **Ctrl+V** | Paste a config (opens a confirmation dialog) |
| **Search / Ctrl+K** (`⌘K` on Mac) | Search the database of real chest locks |
| **SOLVE** | Find the solution and switch to the solution screen |

### Positions

The position drum has one column (`+` / digit / `−`) per plate, above the dependency matrix. Positions can also be set by **clicking a hole in the 3D view**.

- The drum and the 3D view set a position directly, **without applying dependencies**: they are configuration tools, so any position can be set independently of the other plates.
- **Changing a value:**
  - type a digit;
  - `+` / `−`, the `↑` / `↓` arrows and the **mouse wheel over a digit** change it by ±1;
  - pasting several digits replaces the whole set ([formats.md](formats.md#typing-positions-into-the-drum) explains how a run is read).
- **Plate count (2–8):** the **Add plate** / **Remove plate** controls at the edges of the drum add or remove plates. Every plate has 7 positions.
- **In the 3D view**, hovering a hole highlights it; a click or tap sets the position of that hole's plate.

### Dependency matrix

- **Left click** cycles a link: none → same → opposite.
- **Right click** cycles it the other way.
- The diagonal (self-dependency) is locked and striped.
- When the cells get too narrow for a word, a direction icon replaces it: arrows the same way mean "same", apart mean "opposite".

### Keyboard

| Keys | Action |
|---|---|
| `W` / `S` | Select the active plate |
| `A` / `D` | Move the active plate by ±1 (a single plate, **without dependencies**, like the drum) |
| `↑` / `↓` | Change the active plate's position by ±1 |
| `PageUp` / `PageDown` | Set the active plate's position to the maximum / minimum |
| `←` / `→` | Select the previous / next plate |
| `Home` / `End`, `Ctrl+←` / `Ctrl+→` | Select the first / last plate |
| `Backspace` / `Delete` | Remove the active plate |

### Chest hints ("Looks like:")

While you enter starting positions, a row of locks from the database appears between the drum and the matrix. These are locks whose plates match yours **from the left**, so you can find a lock by the plates you can see and get its hidden dependency rules.

- **Matching:** locks are scored by how many of your leftmost plates they match and by their plate count; only good enough matches appear, up to 3, best first. Dependencies you have entered count too: a matching link helps a lock, a missing one costs a little, and an opposite one rules the lock out unless many other links match. The exact formula is in [architecture.md](architecture.md#9-chest-hints-scoring).
- **Reading a card:**
  - a brighter card is a better match;
  - matching plates are green in the preview;
  - the third line shows the lock's rules (`A:B-,C+;D:E-`), green where they match your matrix and red where they contradict it.
- **Click a card** to apply the whole lock: positions and rules. Hovering shows the full name, which may be cut off on the card.
- **Ties:** at an equal match, the entry that agrees better with other sources comes first.
- **Layout:** name and tags on the left, the plate preview on the right. Three cards fit a wide panel, two a narrower one, one a narrow one.
- If the database couldn't be loaded, the row simply doesn't appear.

## Solution screen

The solution appears as a notation string at the top and a list of step cards. Each card shows the plate, a direction badge (green = right, red = left) with the repeat count `×N`, and the notation code. The current step is highlighted, and the active plate is highlighted in the 3D view at the same time.

| Button | Action |
|---|---|
| **‹ Step** | One step back |
| **▶ Auto** | Auto-play (500 ms per step) |
| **Step ›** | One step forward |
| **Back** | Return to the configuration screen |

Click a step in the list to jump to it. If every plate is already centered, there is nothing to solve: instead of an empty list, a note says the lock is already solved and that you may have forgotten to set the starting positions.

### Explore mode

Pressing `A` / `D` or `←` / `→` on the solution screen enters **explore mode**:

- Auto-play stops.
- Plates move freely, independent of the computed solution, with dependencies applied.
- Consecutive moves of one plate in one direction collapse into one entry (`1A3` instead of `1A 1A 1A`); moving back undoes them.
- A blocked move highlights the blocking plate in red and shakes it for 250 ms. On Android devices a block gives a short vibration, and a dial turn or a manual step gives a light tick (silent elsewhere, no permission prompt).
- A **↩ back to step N** separator appears in the step list. Click it, or any played step of the solution, to return to the solution.

## Sharing a lock

The configuration lives in the address bar as `?lock=<dotted>`, optionally followed by `&solve`. Copy the URL to share a lock.

- **Updates:** every config change updates the link in place, without cluttering the history.
- **Opening a link** applies the lock **silently**, with no confirmation dialog. With `&solve`, the solution starts right away.
- **Back / Forward:** switching between the configuration and solution screens adds a history entry, so the browser's Back and Forward switch screens.
- **What a link holds:** always the starting configuration. Explore moves and the playback position are not part of it; the solution is recomputed on the other side.
- **A broken link:** if `?lock` is present but can't be read, a notification says the link is corrupted.

## Searching the chest database

Search (or `Ctrl+K`) looks through the database of real chests and doors from **Gothic 1 Remake**. If the database or the search library failed to load, the button is disabled, with a tooltip explaining why.

One field; the mode is detected automatically:

- **Text:** a fuzzy search (typos are fine) over names and tags in all four database languages (ru/en/de/uk), whatever the interface language. It also matches the asset id a catalog provides (presumably the game's own id, e.g. `OC_Chest_Guard242_Lock`).
- **Positions:** an exact search by plate positions:
  - comma-separated: `4,0,6,3,2,1`;
  - compact, one digit per plate: `406326`.

  Both readings are tried, counting from 0 and from 1.

`↑` / `↓` select a result without leaving the field; `Enter` or a click applies it and switches to the configuration screen.

Results are ordered with each entry's agreement with other sources in mind:
- **position search** sorts by agreement;
- **text search** uses agreement only among results of similar relevance, so a precise name match isn't pushed down.

## Agreement with other sources

The database entries are third-party data of unknown accuracy. Each entry is compared with open lock catalogs. If other sources describe a lock differently and outweigh the sources that agree with our version (see [db-pipeline.md](db-pipeline.md)), the entry is marked:

- in search results and hints, with a **warning triangle** whose tooltip reads "Other sources describe this lock differently";
- on the solution screen, with a **note**, "This entry may contain an error". It advises checking the starting positions and dependencies against the game. If the database holds another entry for the same lock that agrees better with other sources, the note offers to open it.

The note is triggered by the configuration itself, however it was loaded: search, import or a `?lock=` link. The wording deliberately avoids verdicts such as "verified" or "wrong": we know only what our data matches, not which version is right.
