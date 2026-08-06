// How the grid is divided into the areas that each hold one category.
//
// Regular mode is the familiar rectangular box. Irregular mode keeps the same
// number of areas at the same size but lets them take arbitrary connected
// shapes, so you can no longer tell which area a square belongs to just by
// looking at where it sits.
//
// Either way the rest of the game only ever asks two things: which area is
// this square in, and which squares are in this area.

import { neighbours } from './util.js';

function makeRegions(R, boxOf, count) {
  const boxCells = Array.from({ length: count }, () => []);
  for (let i = 0; i < R.cells; i++) boxCells[boxOf[i]].push(i);
  return { boxOf, boxCells, count, irregular: false };
}

export function regularRegions(R) {
  const boxOf = new Int8Array(R.cells);
  for (let i = 0; i < R.cells; i++) {
    boxOf[i] = ((R.row(i) / R.boxH) | 0) * R.boxCols + ((R.col(i) / R.boxW) | 0);
  }
  return makeRegions(R, boxOf, R.boxCount);
}

/** Is every square in this area reachable from every other? */
function connected(R, cells) {
  const first = cells.values().next();
  if (first.done) return true;
  const seen = new Set([first.value]);
  const stack = [first.value];
  while (stack.length) {
    const i = stack.pop();
    for (const n of neighbours(R, i)) {
      if (cells.has(n) && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen.size === cells.size;
}

/**
 * Irregular areas, by wiggling the borders of the regular ones.
 *
 * Growing areas outward from scattered seeds is the obvious approach and it
 * does not work here: at 9 x 9 the areas landlock each other before they reach
 * full size and practically every attempt is thrown away. So instead we start
 * from a layout that is already valid and disturb it.
 *
 * The move is a swap. One square from each of two touching areas trades
 * places, which leaves both areas exactly the same size -- the one property
 * that is awkward to maintain any other way. The swap is kept only if both
 * areas are still in one piece.
 *
 * The two squares are picked from opposite sides of the border independently,
 * and deliberately not as an adjacent pair: swapping neighbours strands the
 * arriving square, because the square it was clinging to is the very one that
 * just left. Nothing can fail -- the worst case is that few swaps are accepted
 * and the board stays close to where it started.
 */
export function irregularRegions(R, rng, moves = 40) {
  const base = regularRegions(R);
  const boxOf = Int8Array.from(base.boxOf);
  const cells = base.boxCells.map((list) => new Set(list));

  const tries = moves * R.cells;
  for (let t = 0; t < tries; t++) {
    const i = (rng() * R.cells) | 0;
    const a = boxOf[i];
    const across = neighbours(R, i).filter((n) => boxOf[n] !== a);
    if (!across.length) continue;
    const b = boxOf[across[(rng() * across.length) | 0]];

    // any square of b that touches a, which is where a can reach
    const border = [];
    for (const cand of cells[b]) {
      if (neighbours(R, cand).some((n) => boxOf[n] === a)) border.push(cand);
    }
    if (!border.length) continue;
    const j = border[(rng() * border.length) | 0];

    cells[a].delete(i);
    cells[a].add(j);
    cells[b].delete(j);
    cells[b].add(i);

    if (connected(R, cells[a]) && connected(R, cells[b])) {
      boxOf[i] = b;
      boxOf[j] = a;
    } else {
      cells[a].add(i);
      cells[a].delete(j);
      cells[b].add(j);
      cells[b].delete(i);
    }
  }

  const regions = makeRegions(R, boxOf, base.count);
  regions.irregular = true;
  return regions;
}
