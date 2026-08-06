// Puzzle generation.
//
// Each box of the grid is given a category, and its squares are filled with
// that many *different* members of it. The grid is then cut into tetrominoes
// freely, across box edges as well as within them, so a piece can straddle two
// or three categories -- reading which ones, and in which arrangement, is what
// tells you where it goes.
//
// One square per box is held back from the cutting and left showing, so every
// box always declares its own category. Everything else the cuts leave over
// becomes an extra clue.

import { CATEGORIES, MEMBERS } from './categories.js';

export class Rules {
  constructor(N, boxW, boxH) {
    this.N = N;
    this.boxW = boxW;
    this.boxH = boxH;
    this.cells = N * N;
    this.hasBoxes = true;
    this.boxCols = N / boxW;
    this.boxRows = N / boxH;
    this.boxCount = this.boxCols * this.boxRows;
    this.boxSize = boxW * boxH;
    // one square per box is reserved as a clue, so it can never be cut into a piece
    this.maxPieces = Math.floor((this.cells - this.boxCount) / 4);

    this.boxCells = Array.from({ length: this.boxCount }, () => []);
    for (let i = 0; i < this.cells; i++) this.boxCells[this.box(i)].push(i);
  }
  idx(r, c) {
    return r * this.N + c;
  }
  row(i) {
    return (i / this.N) | 0;
  }
  col(i) {
    return i % this.N;
  }
  box(i) {
    return ((this.row(i) / this.boxH) | 0) * this.boxCols + ((this.col(i) / this.boxW) | 0);
  }
}

// 3 x 3 is a single box -- one category, two pieces and a clue. It teaches the
// whole idea in about thirty seconds.
export const SIZES = {
  3: {
    key: '3',
    label: '3 × 3',
    rules: new Rules(3, 3, 3),
    pieces: { easy: 1, medium: 2, hard: 2 },
    blurb: 'one box, one category',
  },
  6: {
    key: '6',
    label: '6 × 6',
    rules: new Rules(6, 3, 2),
    pieces: { easy: 4, medium: 5, hard: 7 },
    blurb: 'six boxes, six categories',
  },
  9: {
    key: '9',
    label: '9 × 9',
    rules: new Rules(9, 3, 3),
    // 18 would need a perfect tiling of all 72 unreserved squares, which the
    // greedy cut misses often enough to make the menu lie about the count
    pieces: { easy: 10, medium: 14, hard: 17 },
    blurb: 'nine boxes, nine categories',
  },
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const range = (n) => Array.from({ length: n }, (_, k) => k);

function neighbours(R, i) {
  const r = R.row(i);
  const c = R.col(i);
  const out = [];
  if (r > 0) out.push(i - R.N);
  if (r < R.N - 1) out.push(i + R.N);
  if (c > 0) out.push(i - 1);
  if (c < R.N - 1) out.push(i + 1);
  return out;
}

// --- cutting a box into tetrominoes ----------------------------------------

/** Grow a connected blob of `size` cells, never leaving `free`. */
function growBlob(R, free, seed, size, rng) {
  for (let attempt = 0; attempt < 48; attempt++) {
    const blob = new Set([seed]);
    let stuck = false;
    while (blob.size < size) {
      const cands = [];
      for (const i of blob) {
        for (const n of neighbours(R, i)) {
          if (free.has(n) && !blob.has(n)) cands.push(n);
        }
      }
      if (cands.length === 0) {
        stuck = true;
        break;
      }
      blob.add(cands[(rng() * cands.length) | 0]);
    }
    if (!stuck) return [...blob];
  }
  return null;
}

/**
 * Greedy tiling of everything except `blocked`, always seeding from the
 * most-constrained free square so we strand as few orphans as possible.
 * Cuts ignore box edges entirely. Orphans just become extra clues.
 */
function tile(R, blocked, rng) {
  const free = new Set();
  for (let i = 0; i < R.cells; i++) if (!blocked.has(i)) free.add(i);
  const blobs = [];
  const orphans = [];

  while (free.size > 0) {
    let bestDeg = 99;
    let bestCells = [];
    for (const i of free) {
      let d = 0;
      for (const n of neighbours(R, i)) if (free.has(n)) d++;
      if (d < bestDeg) {
        bestDeg = d;
        bestCells = [i];
      } else if (d === bestDeg) {
        bestCells.push(i);
      }
    }
    const seed = bestCells[(rng() * bestCells.length) | 0];
    const blob = growBlob(R, free, seed, 4, rng);
    if (blob) {
      for (const i of blob) free.delete(i);
      blobs.push(blob);
    } else {
      free.delete(seed);
      orphans.push(seed);
    }
  }
  return { blobs, orphans };
}

export function makePuzzle(R, rng, pieceCount) {
  // one category per box, and the distinct members that fill it
  const boxCat = shuffle(range(CATEGORIES.length), rng).slice(0, R.boxCount);
  const value = new Int8Array(R.cells);
  const variant = new Int8Array(R.cells);
  for (let b = 0; b < R.boxCount; b++) {
    const cells = R.boxCells[b];
    const members = shuffle(range(MEMBERS), rng).slice(0, cells.length);
    cells.forEach((i, n) => {
      value[i] = boxCat[b] + 1;
      variant[i] = members[n];
    });
  }

  // one square per box never gets cut away, so no box hides what it is
  const reserved = new Set(R.boxCells.map((cells) => cells[(rng() * cells.length) | 0]));

  const want = Math.max(1, Math.min(pieceCount, R.maxPieces));
  let best = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const t = tile(R, reserved, rng);
    if (!best || t.blobs.length > best.blobs.length) best = t;
    if (best.blobs.length >= want) break;
  }

  const blobs = shuffle(best.blobs.slice(), rng);
  const kept = blobs.slice(0, Math.min(want, blobs.length));

  const clueCells = new Set([...reserved, ...best.orphans]);
  for (const b of blobs.slice(kept.length)) for (const i of b) clueCells.add(i);

  const clues = [...clueCells]
    .sort((a, b) => a - b)
    .map((i) => ({ r: R.row(i), c: R.col(i), v: value[i], k: variant[i], i }));

  const pieces = kept.map((blob, id) => {
    const cells = blob.map((i) => ({ r: R.row(i), c: R.col(i), v: value[i], k: variant[i] }));
    const minR = Math.min(...cells.map((x) => x.r));
    const minC = Math.min(...cells.map((x) => x.c));
    return {
      id,
      // normalised to a local frame with origin at the bounding-box corner
      cells: cells.map((x) => ({ ...x, r: x.r - minR, c: x.c - minC })),
      solution: { r: minR, c: minC },
    };
  });

  return { boxCat, value, variant, clues, pieces };
}

// --- geometry helpers shared by state + view -------------------------------

export function rotateCells(cells, rot) {
  let out = cells.map((x) => ({ ...x }));
  for (let k = 0; k < (rot & 3); k++) {
    const maxR = Math.max(...out.map((x) => x.r));
    out = out.map((x) => ({ ...x, r: x.c, c: maxR - x.r }));
  }
  const minR = Math.min(...out.map((x) => x.r));
  const minC = Math.min(...out.map((x) => x.c));
  return out.map((x) => ({ ...x, r: x.r - minR, c: x.c - minC }));
}

export function extent(cells) {
  return {
    h: Math.max(...cells.map((x) => x.r)) + 1,
    w: Math.max(...cells.map((x) => x.c)) + 1,
  };
}

// --- rectilinear polygon helpers -------------------------------------------

const pkey = (x, y) => `${x},${y}`;

/**
 * Outline of a polyomino as one closed loop of [x, y] points, x = col, y = row.
 * Tetrominoes never pinch at a corner, so a single loop always exists.
 */
export function outlinePolygon(cells) {
  const has = new Set(cells.map((c) => pkey(c.c, c.r)));
  const next = new Map();
  const add = (a, b) => next.set(pkey(a[0], a[1]), b);

  for (const { r, c } of cells) {
    const x = c;
    const y = r;
    if (!has.has(pkey(x, y - 1))) add([x, y], [x + 1, y]);
    if (!has.has(pkey(x + 1, y))) add([x + 1, y], [x + 1, y + 1]);
    if (!has.has(pkey(x, y + 1))) add([x + 1, y + 1], [x, y + 1]);
    if (!has.has(pkey(x - 1, y))) add([x, y + 1], [x, y]);
  }

  const start = next.keys().next().value;
  const loop = [];
  let cur = start.split(',').map(Number);
  for (let guard = 0; guard < 64; guard++) {
    loop.push(cur);
    const nxt = next.get(pkey(cur[0], cur[1]));
    if (!nxt) break;
    if (pkey(nxt[0], nxt[1]) === start) break;
    cur = nxt;
  }

  // merge collinear runs, otherwise the inset below has parallel neighbours
  const merged = [];
  for (let i = 0; i < loop.length; i++) {
    const p = loop[(i + loop.length - 1) % loop.length];
    const q = loop[i];
    const s = loop[(i + 1) % loop.length];
    const cross = (q[0] - p[0]) * (s[1] - q[1]) - (q[1] - p[1]) * (s[0] - q[0]);
    if (Math.abs(cross) > 1e-9) merged.push(q);
  }
  return merged;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Push every edge inward by d so neighbouring tiles read as separate cards. */
export function insetPolygon(pts, d) {
  const n = pts.length;
  const inward = signedArea(pts) > 0 ? 1 : -1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const nx = inward * -dy;
    const ny = inward * dx;
    lines.push({ px: a[0] + nx * d, py: a[1] + ny * d, dx, dy });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n];
    const l2 = lines[i];
    const den = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(den) < 1e-9) {
      out.push([l2.px, l2.py]);
      continue;
    }
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / den;
    out.push([l1.px + l1.dx * t, l1.py + l1.dy * t]);
  }
  return out;
}

/** Shared edges between cells of the same piece, for the hairline scoring. */
export function interiorSegments(cells) {
  const has = new Set(cells.map((c) => pkey(c.c, c.r)));
  const segs = [];
  for (const { r, c } of cells) {
    if (has.has(pkey(c + 1, r))) {
      segs.push([
        [c + 1, r],
        [c + 1, r + 1],
      ]);
    }
    if (has.has(pkey(c, r + 1))) {
      segs.push([
        [c, r + 1],
        [c + 1, r + 1],
      ]);
    }
  }
  return segs;
}
