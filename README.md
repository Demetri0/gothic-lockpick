# Gothic Lockpick

A browser solver and 3D visualizer for the disc-lock puzzle from Gothic 1 Remake, with a searchable database of the game's chest locks.

**Open the app: https://demetri0.github.io/gothic-lockpick/**

https://github.com/user-attachments/assets/154eaeb2-4bf9-4c56-b6bb-d996facdf326

Screenshots: [configuration](screenshots/config.png) · [solution](screenshots/solve.png) · [search](screenshots/search.png) · [mobile](screenshots/mobile/composed.png)

## Features

- **Shortest solution:** the minimal number of presses and, in practice, the fewest plate switches among them, so the step list is short.
- **3D view** of the lock, with step-by-step playback and an explore mode for trying moves yourself.
- **Chest database** of real Gothic 1 Remake locks: search by name or by the plate positions you see, and live "Looks like:" hints while you type.
- **Agreement marks:** entries that other lock catalogs dispute, outweighing the ones that agree, are flagged, so you know to double-check them in game.
- **Shareable links:** the lock lives in the URL.
- **Import and export** in several text formats; import also accepts unlockmyloot lock codes.
- **Three interface languages:** Русский, Українська, English.

## How to use

1. **Enter the lock.** Set each plate's position on the drum (or click a hole in the 3D view); add or remove plates at the drum's edges.
2. **Add the dependencies** in the matrix: click a cell to cycle none → same → opposite. Or **find the chest** with Search (`Ctrl+K`) or a "Looks like:" hint, which fills in both positions and dependencies.
3. Press **SOLVE**.
4. **Follow the steps** with **Step ›**, **‹ Step** or **▶ Auto**. Each card says which plate to move, which way and how many times.

| Keys | Configuration screen | Solution screen |
|---|---|---|
| `W` / `S` | select a plate | select a plate |
| `A` / `D` | move the plate (no dependencies) | explore: move with dependencies |
| `↑` / `↓` | change the selected plate's position | select a plate |
| `←` / `→` | select a plate | explore: move with dependencies |
| `Ctrl+K` | search the chest database | — |
| `Ctrl+C` / `Ctrl+V` | copy / paste a config | — |

The full guide is in [docs/user-guide.md](docs/user-guide.md). The step notation (`1A`, `2D3`) is explained in [docs/formats.md](docs/formats.md#move-notation).

## Chest database

The database holds a few hundred chests and doors from Gothic 1 Remake. It was collected by the community and cross-checked against open lock catalogs:

- [gothic-remake-lockbreaker](https://github.com/dsazz/gothic-remake-lockbreaker) by dsazz;
- [unlockmyloot](https://github.com/1h8s/unlockmyloot);
- [gothic-lockpick-emulator](https://github.com/religiosa1/gothic-lockpick-emulator) by religiosa1.

This is third-party data of unknown accuracy. An entry that other sources dispute, outweighing the ones that agree, shows a warning triangle in search. On the solution screen it shows a note suggesting that you check the starting positions and dependencies against the game, and it offers a better-agreeing entry for the same lock when there is one.

## Development

```bash
npm install
npm start                            # http://localhost:3000 — the app needs HTTP
npx playwright test                  # test suite
npm run test:corpus                  # solve every chest in the database (~3 min)
git config core.hooksPath .githooks  # once: pre-commit and pre-push checks
```

The app is a single `index.html` with no build step. Read more in:

- [docs/architecture.md](docs/architecture.md): code structure, solver, workers, URL state, localization;
- [docs/formats.md](docs/formats.md): config formats, notation, position input;
- [docs/db-pipeline.md](docs/db-pipeline.md): how the chest database is built and maintained;
- [CLAUDE.md](CLAUDE.md): conventions for AI coding agents (also read as `AGENTS.md`).

## Browser support

Chrome/Edge 108+, Firefox 110+, Safari 16.4+. There are no polyfills; the floor comes from three features:

| Feature | Chrome/Edge | Firefox | Safari |
|---|---|---|---|
| `dvh` viewport units | 108 | 101 | 15.4 |
| container queries | 105 | **110** | 16.0 |
| regex lookbehind | 62 | 78 | **16.4** |

The first two degrade gracefully, only the layout suffers. Lookbehind doesn't: on Safari older than 16.4 the main script fails to parse and the app doesn't start.
