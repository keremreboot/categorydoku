# Categorydoku

Sudoku cut into tetrominoes — except the nine symbols are **categories**, and
every square shows a picture rather than a digit. A fox and an elephant are the
same symbol; a rocket and a sailboat are the same symbol. Fit the pieces back
into the grid so no row, column or 3 × 3 box repeats a category.

**Play:** https://keremreboot.github.io/categorydoku/

## How it works

A solved grid is generated, then cut into tetrominoes. Because N × N is never a
multiple of four for these board sizes, the leftover squares stay on the board
as clues — they are not decoration, they are the remainder that makes the tiling
possible at all: `N² = 4 × pieces + clues`.

You may park a piece on top of a clue, but burying a clue always strands an
empty square somewhere else, so no finished grid has one.

## Controls

Drag a piece onto the grid, or tap once to carry it and tap again to drop. On
touch the carried piece rides above your fingertip so your hand never covers the
squares you are aiming at.

| Key | Action |
| --- | --- |
| `R` | rotate the carried piece (when rotation is enabled) |
| `Esc` | cancel the carry / close a panel |
| `U` | undo |
| `N` | new puzzle |

The **Key** panel lists every category and its pictures. **Options** holds the
board size (3 × 3, 6 × 6, 9 × 9), the piece count, rotation, and an assist mode
that colours squares by category.

Puzzles are seeded — the URL hash is the seed, so a link reproduces the exact
board.

## Running it locally

No build step and no dependencies; it is plain ES modules, so it needs to be
served over http rather than opened from the filesystem.

```bash
python -m http.server 8124
```

## Layout

- `src/categories.js` — the nine categories and their icon sets
- `src/sudoku.js` — puzzle generation and the polyomino geometry helpers
- `src/state.js` — board state, placement rules, conflict detection, undo
- `src/view.js` — 2D canvas renderer and the responsive board/tray layout
- `src/main.js` — pointer, keyboard and panel handling

Built on the mechanic of Movedoku, reworked from a Three.js scene into a
dependency-free 2D canvas so it runs well on a phone.
