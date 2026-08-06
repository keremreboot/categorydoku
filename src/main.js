// Glue: puzzle -> state -> view, plus pointer, keyboard and sheet handling.

import { makePuzzle, mulberry32, extent, rotateCells, SIZES } from './sudoku.js';
import { CATEGORIES } from './categories.js';
import { Game } from './state.js';
import { View } from './view.js';

const canvas = document.getElementById('stage');
const view = new View(canvas);

const ui = {};
for (const id of [
  'status', 'clues', 'banner', 'size', 'difficulty', 'rotatable',
  'newGame', 'undo', 'rotate', 'reset', 'reveal', 'seed', 'blurb', 'legend',
  'keyBtn', 'moreBtn', 'keySheet', 'moreSheet', 'scrim',
]) {
  ui[id] = document.getElementById(id);
}

// A carried piece rides above the fingertip, otherwise the hand covers exactly
// the squares you are trying to aim at. The lift shifts the piece *and* the
// drop target together, so what you see is where it lands.
const TOUCH_LIFT = 0.95;

let game = null;
let held = null; // { piece, grabR, grabC, sticky, lift, downX, downY, moved, from }
let pointer = { x: 0, y: 0, has: false };
let dirty = true;

const mark = () => {
  dirty = true;
};

// --- settings --------------------------------------------------------------

const SETTINGS_KEY = 'categorydoku.settings';

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    saved = {};
  }
  if (saved.size && SIZES[saved.size]) ui.size.value = saved.size;
  if (saved.difficulty) ui.difficulty.value = saved.difficulty;
  if ('rotatable' in saved) ui.rotatable.checked = !!saved.rotatable;
}

function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        size: ui.size.value,
        difficulty: ui.difficulty.value,
        rotatable: ui.rotatable.checked,
      })
    );
  } catch {
    /* private mode — settings just don't persist */
  }
}

function currentSize() {
  return SIZES[ui.size.value] ?? SIZES[9];
}

/** Difficulty labels carry the piece count, which differs per board size. */
function syncDifficultyLabels() {
  const counts = currentSize().pieces;
  for (const opt of ui.difficulty.options) {
    const n = counts[opt.value];
    opt.textContent = `${n} piece${n === 1 ? '' : 's'} — ${opt.dataset.name}`;
  }
}

/** The key lists only the categories this puzzle actually uses. */
function buildLegend() {
  const used = [...game.boxCat].sort((a, b) => a - b);
  ui.legend.replaceChildren(
    ...used.map((ci) => CATEGORIES[ci]).map((cat) => {
      const row = document.createElement('div');
      row.className = 'legend-row';
      const name = document.createElement('span');
      name.className = 'legend-name';
      name.textContent = cat.name;
      const icons = document.createElement('span');
      icons.className = 'legend-icons';
      icons.textContent = cat.icons.join(' ');
      row.append(name, icons);
      return row;
    })
  );
}

// --- game lifecycle --------------------------------------------------------

function newGame(seed = (Math.random() * 1e9) | 0) {
  const size = currentSize();
  const rng = mulberry32(seed);
  const puzzle = makePuzzle(size.rules, rng, size.pieces[ui.difficulty.value]);
  game = new Game(size.rules, puzzle);
  held = null;
  view.setPuzzle(game);
  view.setGhost(null);
  ui.seed.textContent = `No. ${String(seed).slice(-6).padStart(6, '0')}`;
  ui.blurb.textContent = size.blurb;
  ui.banner.classList.remove('show');
  history.replaceState(null, '', `#${seed}`);
  buildLegend();
  refresh();
}

function refresh() {
  view.refresh(game);
  ui.status.textContent = `${game.placedCount()} of ${game.pieces.length} placed`;

  const bad = game.conflicts().size;
  const buried = game.buriedClues();
  const open = game.rules.cells - game.filledCount();
  // both warnings matter independently, so never let one mask the other
  const notes = [];
  if (bad) notes.push(`${bad} square${bad === 1 ? '' : 's'} misplaced`);
  if (buried) notes.push(`${buried} clue${buried === 1 ? '' : 's'} buried`);
  if (!notes.length) notes.push(`${open} square${open === 1 ? '' : 's'} open`);
  ui.clues.textContent = notes.join(' · ');
  ui.clues.classList.toggle('warn', bad > 0 || buried > 0);

  ui.banner.classList.toggle('show', game.isSolved());
  ui.undo.disabled = game.undoStack.length === 0;
  ui.rotate.hidden = !ui.rotatable.checked;
  ui.rotate.disabled = !held;
  mark();
}

// --- held-piece maths ------------------------------------------------------

/** Pointer position corrected for the fingertip lift. */
function aim() {
  return { x: pointer.x, y: pointer.y - (held ? held.lift : 0) };
}

function anchorUnderCursor() {
  const a = aim();
  return {
    r: Math.round(a.y - 0.5 - held.grabR),
    c: Math.round(a.x - 0.5 - held.grabC),
  };
}

function updateHeld() {
  if (!held) return;
  const { piece } = held;
  const a = aim();
  if (pointer.has && view.onBoard(a.x, a.y)) {
    const { r, c } = anchorUnderCursor();
    view.setHeld(piece.id, c, r);
    view.setGhost(game.footprint(piece, r, c), game.canPlace(piece, r, c));
  } else {
    view.setHeld(piece.id, a.x - held.grabC - 0.5, a.y - held.grabR - 0.5);
    view.setGhost(null);
  }
  mark();
}

function setRot(piece, rot) {
  if (piece.rot === rot) return;
  piece.rot = rot;
  view.rebuildPiece(view.pieceViews[piece.id], game.cellsOf(piece));
}

function pickUp(pieceId, worldX, worldY, lift) {
  const piece = game.pieces[pieceId];
  held = {
    piece,
    grabR: 0,
    grabC: 0,
    sticky: true,
    moved: false,
    lift,
    from: { placed: piece.placed, r: piece.r, c: piece.c, rot: piece.rot },
  };

  // grab the piece by the cell the pointer is actually over
  if (piece.placed) {
    held.grabR = Math.floor(worldY) - piece.r;
    held.grabC = Math.floor(worldX) - piece.c;
    // undo is recorded on drop, from held.from — a cancelled drag leaves no trace
    game.lift(piece, false);
  } else {
    const e = extent(rotateCells(piece.base, piece.rot));
    held.grabR = (e.h - 1) / 2;
    held.grabC = (e.w - 1) / 2;
  }
  view.setHeld(piece.id, worldX, worldY);
  refresh();
}

function returnHome() {
  const { piece, from } = held;
  setRot(piece, from.placed ? from.rot : 0);
  if (from.placed) game.place(piece, from.r, from.c, from.rot, false);
  view.syncPiece(piece);
}

function drop() {
  if (!held) return;
  const { piece, from } = held;
  const a = aim();

  if (pointer.has && view.onBoard(a.x, a.y)) {
    const { r, c } = anchorUnderCursor();
    if (game.canPlace(piece, r, c)) {
      game.pushSnapshot({ id: piece.id, ...from });
      game.place(piece, r, c, piece.rot, false);
      finishDrop();
      return;
    }
  }
  if (pointer.has && view.onTray(a.x, a.y)) {
    setRot(piece, 0);
    if (from.placed) game.pushSnapshot({ id: piece.id, ...from });
    finishDrop();
    return;
  }
  returnHome();
  finishDrop();
}

function finishDrop() {
  const piece = held.piece;
  held = null;
  view.setHeld(null);
  view.setGhost(null);
  view.syncPiece(piece);
  refresh();
}

function rotateHeld() {
  if (!held || !ui.rotatable.checked) return;
  const { piece } = held;
  setRot(piece, (piece.rot + 1) & 3);
  const e = game.sizeOf(piece);
  held.grabR = (e.h - 1) / 2;
  held.grabC = (e.w - 1) / 2;
  refresh(); // before updateHeld, which owns the carried tile's tint
  updateHeld();
}

function cancelHeld() {
  if (!held) return;
  returnHome();
  finishDrop();
}

// --- pointer ---------------------------------------------------------------

function syncPointer(ev) {
  const w = view.pointerWorld(ev);
  pointer = { x: w.x, y: w.y, has: true };
}

canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;
  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  syncPointer(ev);
  const lift = ev.pointerType === 'touch' ? TOUCH_LIFT : 0;

  if (held) {
    // second half of a tap-to-carry: snap under the pointer now, commit on release
    held.lift = lift;
    held.sticky = false;
    updateHeld();
    return;
  }
  // fingertips need slack; a mouse does not
  const id = view.pickPiece(pointer.x, pointer.y, lift ? 0.35 : 0);
  if (id != null) {
    pickUp(id, pointer.x, pointer.y, lift);
    held.downX = ev.clientX;
    held.downY = ev.clientY;
    updateHeld();
  }
});

canvas.addEventListener('pointermove', (ev) => {
  syncPointer(ev);
  if (!held) return;
  if (
    held.downX != null &&
    Math.abs(ev.clientX - held.downX) + Math.abs(ev.clientY - held.downY) > 8
  ) {
    held.moved = true;
    held.sticky = false;
  }
  updateHeld();
});

canvas.addEventListener('pointerup', (ev) => {
  syncPointer(ev);
  if (held && !held.sticky) drop();
});

canvas.addEventListener('pointercancel', () => cancelHeld());

canvas.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  cancelHeld();
});

addEventListener('keydown', (ev) => {
  if (ev.target instanceof HTMLSelectElement || ev.target instanceof HTMLInputElement) return;
  const k = ev.key.toLowerCase();
  if (k === 'r') rotateHeld();
  else if (k === 'escape') {
    if (held) cancelHeld();
    else closeSheets();
  } else if (k === 'u' || (k === 'z' && (ev.ctrlKey || ev.metaKey))) {
    doUndo();
  } else if (k === 'n') newGame();
});

// --- ui --------------------------------------------------------------------

function rebuildAllPieces() {
  for (const p of game.pieces) {
    view.rebuildPiece(view.pieceViews[p.id], game.cellsOf(p));
    view.syncPiece(p);
  }
  refresh();
}

function doUndo() {
  if (held || !game.undo()) return;
  for (const p of game.pieces) {
    view.rebuildPiece(view.pieceViews[p.id], game.cellsOf(p));
    view.syncPiece(p);
  }
  refresh();
}

function openSheet(sheet) {
  closeSheets();
  sheet.hidden = false;
  ui.scrim.hidden = false;
}

function closeSheets() {
  ui.keySheet.hidden = true;
  ui.moreSheet.hidden = true;
  ui.scrim.hidden = true;
}

ui.scrim.addEventListener('click', closeSheets);
for (const btn of document.querySelectorAll('[data-close]')) {
  btn.addEventListener('click', closeSheets);
}
ui.keyBtn.addEventListener('click', () => openSheet(ui.keySheet));
ui.moreBtn.addEventListener('click', () => openSheet(ui.moreSheet));

ui.newGame.addEventListener('click', () => newGame());
ui.undo.addEventListener('click', doUndo);
ui.rotate.addEventListener('click', rotateHeld);

ui.difficulty.addEventListener('change', () => {
  saveSettings();
  newGame();
});
ui.size.addEventListener('change', () => {
  saveSettings();
  syncDifficultyLabels();
  newGame();
});
ui.rotatable.addEventListener('change', () => {
  saveSettings();
  refresh();
});

ui.reset.addEventListener('click', () => {
  held = null;
  view.setHeld(null);
  view.setGhost(null);
  game.reset();
  rebuildAllPieces();
  closeSheets();
});
ui.reveal.addEventListener('click', () => {
  held = null;
  view.setHeld(null);
  view.setGhost(null);
  game.solve();
  rebuildAllPieces();
  closeSheets();
});

new ResizeObserver(() => {
  view.resize();
  mark();
}).observe(canvas);

// --- loop ------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const moving = view.update(dt);
  if (moving || dirty) {
    view.render();
    dirty = false;
  }
  requestAnimationFrame(frame);
}

loadSettings();
syncDifficultyLabels();

const fromHash = parseInt(location.hash.slice(1), 10);
newGame(Number.isFinite(fromHash) ? fromHash : undefined);
requestAnimationFrame(frame);

// handy while prototyping: categorydoku.game / .view from the console
window.categorydoku = {
  get game() {
    return game;
  },
  view,
  newGame,
};
