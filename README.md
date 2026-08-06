# Categorydoku

A grid cut into tetrominoes, where **every box is a category**. One box is
Animals, another is Fruit, another is Vehicles — and each holds nine *different*
pictures from its own category, never the same one twice.

The pieces are cut across box edges, so a single tetromino can carry two or
three categories at once. Reading which ones, and how they sit relative to each
other, is what tells you where it belongs.

**Play:** https://keremreboot.github.io/categorydoku/

## Rules

- Every square in a box must come from that box's category.
- No picture may appear twice in the same box.
- Fill the grid and you have solved it.

One square in every box is held back from the cutting and left showing as a
clue, so a box always declares what it is. Everything else the cuts leave over
becomes an extra clue — which is why easier puzzles have more of them.

You may park a piece on top of a clue, but burying one always strands an empty
square somewhere else, so no finished grid has a buried clue.

## Controls

Drag a piece onto the grid, or tap once to carry it and tap again to drop. On
touch the carried piece rides above your fingertip so your hand never covers the
squares you are aiming at, and a drop only commits when you lift off — so you
can nudge it first.

| Key | Action |
| --- | --- |
| `R` | rotate the carried piece (when rotation is enabled) |
| `Esc` | cancel the carry / close a panel |
| `U` | undo |
| `N` | new puzzle |

The **Key** panel lists the categories this puzzle uses and every picture in
them. **Options** holds the board size (3 × 3, 6 × 6, 9 × 9), the piece count,
and rotation.

Puzzles are seeded — the URL hash is the seed, so a link reproduces the exact
board.

Nothing is colour-coded on purpose. Working out that a fox and an owl are the
same kind of thing is the puzzle; a colour per category would hand it over.

## Running it locally

No build step and no dependencies; it is plain ES modules, so it needs to be
served over http rather than opened from the filesystem.

```bash
python -m http.server 8124
```

## Layout

- `src/categories.js` — the categories and their nine-picture sets
- `src/sudoku.js` — puzzle generation and the polyomino geometry helpers
- `src/state.js` — board state, placement, rule checking, undo
- `src/view.js` — 2D canvas renderer and the responsive board/tray layout
- `src/main.js` — pointer, keyboard and panel handling

Every icon is Unicode 12 or older. Windows 10's emoji font stops there, and a
missing glyph draws as an empty box — an unreadable square, not a cosmetic
problem. Check replacements on the oldest target you care about.

Built on the piece-moving mechanic of Movedoku, reworked from a Three.js scene
into a dependency-free 2D canvas so it runs well on a phone.
