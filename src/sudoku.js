// Puzzle generation.
//
// Each box of the grid is given a category, and its squares are filled with
// that many *different* members of it. The grid is then cut into tetrominoes
// freely, across box edges as well as within them, so a piece can straddle two
// or three categories -- reading which ones, and in which arrangement, is what
// tells you where it goes.
//
// One square per box is normally held back from the cutting and left showing,
// so every box declares its own category. Everything else the cuts leave over
// becomes an extra clue.
//
// Expert puzzles leave some boxes *blind*: no square is held back there, and
// the cut is rejected unless those boxes come out covered edge to edge by kept
// pieces, so nothing shows through. A blind box never says what it is -- you
// work it out from the pieces that reach into it from its lit neighbours, or
// by elimination once the other boxes are settled.

import { CATEGORIES, MEMBERS } from './categories.js';
import { shuffle, range, neighbours } from './util.js';
import { regularRegions, irregularRegions } from './regions.js';

/**
 * Board geometry only. Which squares belong to which area is deliberately not
 * here: irregular boards decide that per puzzle, so it lives on the puzzle.
 */
export class Rules {
  constructor(N, boxW, boxH) {
    this.N = N;
    this.boxW = boxW;
    this.boxH = boxH;
    this.cells = N * N;
    this.boxCols = N / boxW;
    this.boxRows = N / boxH;
    this.boxCount = this.boxCols * this.boxRows;
    this.boxSize = boxW * boxH;
    // one square per area is reserved as a clue, so it can never become a piece
    this.maxPieces = Math.floor((this.cells - this.boxCount) / 4);
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
}

// 3 x 3 is a single box -- one category, two pieces and a clue. It teaches the
// whole idea in about thirty seconds.
export const SIZES = {
  3: {
    key: '3',
    label: '3 × 3',
    rules: new Rules(3, 3, 3),
    // no expert: a lone box has nothing to deduce from, and 9 squares never
    // divide into tetrominoes cleanly, so a leftover clue is unavoidable
    pieces: {
      easy: { count: 1, dark: 0 },
      medium: { count: 2, dark: 0 },
      hard: { count: 2, dark: 0 },
    },
    blurb: 'one box, one category',
  },
  6: {
    key: '6',
    label: '6 × 6',
    rules: new Rules(6, 3, 2),
    pieces: {
      easy: { count: 4, dark: 0 },
      medium: { count: 5, dark: 0 },
      hard: { count: 7, dark: 0 },
      expert: { count: 7, dark: 2 },
    },
    blurb: 'six boxes, six categories',
  },
  9: {
    key: '9',
    label: '9 × 9',
    rules: new Rules(9, 3, 3),
    // 18 would need a perfect tiling of all 72 unreserved squares, which the
    // greedy cut misses often enough to make the menu lie about the count
    pieces: {
      easy: { count: 10, dark: 0 },
      medium: { count: 14, dark: 0 },
      hard: { count: 17, dark: 0 },
      expert: { count: 17, dark: 3 },
    },
    blurb: 'nine boxes, nine categories',
  },
};

export { mulberry32 } from './util.js';

// --- cutting the grid into tetrominoes -------------------------------------

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

/**
 * One go at cutting the grid for `darkCount` blind boxes. Returns null if the
 * cut does not work out, because it is far cheaper to re-cut than to repair:
 * a blind box is only blind if nothing shows through it, and both the leftover
 * squares and any piece we decline to keep would show.
 */
function attemptCut(R, R2, rng, wantPieces, darkCount, strict) {
  const dark = new Set(shuffle(range(R2.count), rng).slice(0, darkCount));

  // every lit area keeps one square back, so it always declares its category
  const reserved = new Set();
  for (let b = 0; b < R2.count; b++) {
    if (dark.has(b)) continue;
    const cells = R2.boxCells[b];
    reserved.add(cells[(rng() * cells.length) | 0]);
  }

  const { blobs, orphans } = tile(R, reserved, rng);
  if (orphans.some((i) => dark.has(R2.boxOf[i]))) return null;

  const reachesDark = (blob) => blob.some((i) => dark.has(R2.boxOf[i]));
  const forced = blobs.filter(reachesDark);
  const spare = shuffle(
    blobs.filter((b) => !reachesDark(b)),
    rng
  );
  const cap = Math.min(wantPieces, blobs.length);
  if (forced.length > cap) return null;

  const kept = forced.concat(spare.slice(0, cap - forced.length));
  if (strict && kept.length < wantPieces) return null;

  const keptSet = new Set(kept);
  const clueCells = new Set([...reserved, ...orphans]);
  for (const blob of blobs) {
    if (!keptSet.has(blob)) for (const i of blob) clueCells.add(i);
  }
  for (const i of clueCells) if (dark.has(R2.boxOf[i])) return null;

  return { kept: shuffle(kept, rng), clueCells, dark: [...dark].sort((a, b) => a - b) };
}

export function makePuzzle(R, rng, spec) {
  const regions =
    (spec.irregular ? irregularRegions(R, rng) : null) || regularRegions(R);

  const wantPieces = Math.max(1, Math.min(spec.count, R.maxPieces));
  // at least one area must stay lit, or there is nothing to reason from
  const wantDark = Math.min(spec.dark || 0, Math.max(0, regions.count - 1));

  // one category per area, and the distinct members that fill it
  const boxCat = shuffle(range(CATEGORIES.length), rng).slice(0, regions.count);
  const value = new Int8Array(R.cells);
  const variant = new Int8Array(R.cells);
  for (let b = 0; b < regions.count; b++) {
    const cells = regions.boxCells[b];
    const members = shuffle(range(MEMBERS), rng).slice(0, cells.length);
    cells.forEach((i, n) => {
      value[i] = boxCat[b] + 1;
      variant[i] = members[n];
    });
  }

  // Where the clues fall is left to the cut, which now and then dumps most of
  // them into one area and hands it over. So take several workable cuts and
  // keep the one that spreads them most evenly.
  const spread = (plan) => {
    const per = new Array(regions.count).fill(0);
    for (const i of plan.clueCells) per[regions.boxOf[i]]++;
    return { worst: Math.max(...per), lumpiness: per.reduce((a, n) => a + n * n, 0) };
  };
  const better = (a, b) =>
    a.score.worst !== b.score.worst
      ? a.score.worst < b.score.worst
      : a.score.lumpiness < b.score.lumpiness;

  // fewer blind areas is a better outcome than a puzzle we failed to build,
  // so step down rather than give up, and finally accept fewer pieces
  let plan = null;
  for (let dark = wantDark; dark >= 0 && !plan; dark--) {
    let found = 0;
    for (let attempt = 0; attempt < 240 && found < 12; attempt++) {
      const cand = attemptCut(R, regions, rng, wantPieces, dark, true);
      if (!cand) continue;
      found++;
      cand.score = spread(cand);
      if (!plan || better(cand, plan)) plan = cand;
    }
  }
  if (!plan) plan = attemptCut(R, regions, rng, wantPieces, 0, false);

  const clues = [...plan.clueCells]
    .sort((a, b) => a - b)
    .map((i) => ({ r: R.row(i), c: R.col(i), v: value[i], k: variant[i], i }));

  const pieces = plan.kept.map((blob, id) => {
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

  return { regions, boxCat, value, variant, clues, pieces, dark: plan.dark };
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
