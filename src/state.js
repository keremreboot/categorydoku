// Board state + sudoku validation. No rendering in here.
//
// Clues are placeable-over: a piece may be dropped on a clue square, which
// buries it. Because pieces + clues tile the grid exactly, burying a clue
// always strands an empty square elsewhere, so it can never be part of a
// finished solution -- it is manoeuvring room, not a second solution space.
// buriedClues() exists so the UI can say so out loud.

import { rotateCells, extent } from './sudoku.js';

export const EMPTY = -1;
export const CLUE = -2;

export class Game {
  constructor(rules, puzzle) {
    this.rules = rules;
    this.puzzle = puzzle;
    this.clues = puzzle.clues;

    this.pieces = puzzle.pieces.map((p) => ({
      id: p.id,
      base: p.cells,
      solution: p.solution,
      rot: 0,
      placed: false,
      r: 0,
      c: 0,
    }));

    this.owner = new Int16Array(rules.cells).fill(EMPTY);
    this.value = new Int8Array(rules.cells);
    this.variant = new Int8Array(rules.cells);
    this.clueValue = new Int8Array(rules.cells); // 0 where there is no clue
    this.clueVariant = new Int8Array(rules.cells);
    for (const cl of this.clues) {
      this.owner[cl.i] = CLUE;
      this.value[cl.i] = cl.v;
      this.variant[cl.i] = cl.k;
      this.clueValue[cl.i] = cl.v;
      this.clueVariant[cl.i] = cl.k;
    }

    this.undoStack = [];
  }

  cellsOf(piece) {
    return rotateCells(piece.base, piece.rot);
  }

  sizeOf(piece) {
    return extent(this.cellsOf(piece));
  }

  /** Absolute cells for a hypothetical placement at (r, c). */
  footprint(piece, r, c, rot = piece.rot) {
    return rotateCells(piece.base, rot).map((cell) => ({
      ...cell,
      r: r + cell.r,
      c: c + cell.c,
    }));
  }

  canPlace(piece, r, c, rot = piece.rot) {
    const R = this.rules;
    for (const cell of this.footprint(piece, r, c, rot)) {
      if (cell.r < 0 || cell.r >= R.N || cell.c < 0 || cell.c >= R.N) return false;
      const held = this.owner[R.idx(cell.r, cell.c)];
      // empty squares, clue squares and our own squares are all fair game;
      // only another piece blocks
      if (held !== EMPTY && held !== CLUE && held !== piece.id) return false;
    }
    return true;
  }

  place(piece, r, c, rot = piece.rot, record = true) {
    if (!this.canPlace(piece, r, c, rot)) return false;
    if (record) this.pushUndo(piece);
    if (piece.placed) this.clearCells(piece);
    piece.rot = rot & 3;
    piece.r = r;
    piece.c = c;
    piece.placed = true;
    for (const cell of this.footprint(piece, r, c)) {
      const i = this.rules.idx(cell.r, cell.c);
      this.owner[i] = piece.id;
      this.value[i] = cell.v;
      this.variant[i] = cell.k;
    }
    return true;
  }

  lift(piece, record = true) {
    if (!piece.placed) return;
    if (record) this.pushUndo(piece);
    this.clearCells(piece);
    piece.placed = false;
  }

  /** Vacate a piece's squares, uncovering any clue that was underneath. */
  clearCells(piece) {
    for (let i = 0; i < this.rules.cells; i++) {
      if (this.owner[i] !== piece.id) continue;
      if (this.clueValue[i]) {
        this.owner[i] = CLUE;
        this.value[i] = this.clueValue[i];
        this.variant[i] = this.clueVariant[i];
      } else {
        this.owner[i] = EMPTY;
        this.value[i] = 0;
        this.variant[i] = 0;
      }
    }
  }

  pushUndo(piece) {
    this.pushSnapshot({
      id: piece.id,
      placed: piece.placed,
      r: piece.r,
      c: piece.c,
      rot: piece.rot,
    });
  }

  /** Record a state the caller captured earlier (before a drag started). */
  pushSnapshot(snap) {
    this.undoStack.push({ ...snap });
    if (this.undoStack.length > 200) this.undoStack.shift();
  }

  undo() {
    const snap = this.undoStack.pop();
    if (!snap) return false;
    const piece = this.pieces[snap.id];
    if (piece.placed) {
      this.clearCells(piece);
      piece.placed = false;
    }
    if (snap.placed) {
      piece.rot = snap.rot;
      this.place(piece, snap.r, snap.c, snap.rot, false);
    } else {
      piece.rot = snap.rot;
    }
    return true;
  }

  /** Cell indices whose category is duplicated in its row, column or box. */
  conflicts() {
    const R = this.rules;
    const bad = new Set();
    const groups = [];
    for (let k = 0; k < R.N; k++) groups.push([], [], []);
    for (let i = 0; i < R.cells; i++) {
      if (this.owner[i] === EMPTY) continue;
      groups[R.row(i) * 3].push(i);
      groups[R.col(i) * 3 + 1].push(i);
      if (R.hasBoxes) groups[R.box(i) * 3 + 2].push(i);
    }
    for (const group of groups) {
      const seen = new Map();
      for (const i of group) {
        const v = this.value[i];
        if (seen.has(v)) {
          bad.add(i);
          bad.add(seen.get(v));
        } else {
          seen.set(v, i);
        }
      }
    }
    return bad;
  }

  isClueVisible(i) {
    return this.clueValue[i] !== 0 && this.owner[i] === CLUE;
  }

  /** Clues a piece is currently sitting on top of. */
  buriedClues() {
    let n = 0;
    for (let i = 0; i < this.rules.cells; i++) {
      if (this.clueValue[i] && this.owner[i] >= 0) n++;
    }
    return n;
  }

  filledCount() {
    let n = 0;
    for (let i = 0; i < this.rules.cells; i++) if (this.owner[i] !== EMPTY) n++;
    return n;
  }

  placedCount() {
    return this.pieces.filter((p) => p.placed).length;
  }

  isSolved() {
    return this.filledCount() === this.rules.cells && this.conflicts().size === 0;
  }

  /** Drop every piece into its generated home. Sanity check / "reveal". */
  solve() {
    for (const p of this.pieces) this.lift(p, false);
    for (const p of this.pieces) {
      p.rot = 0;
      this.place(p, p.solution.r, p.solution.c, 0, false);
    }
    this.undoStack.length = 0;
  }

  reset() {
    for (const p of this.pieces) {
      this.lift(p, false);
      p.rot = 0;
    }
    this.undoStack.length = 0;
  }
}
