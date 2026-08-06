// 2D canvas presentation layer: cut-paper tiles on newsprint.
//
// Everything is laid out in board-cell units and projected through a single
// (origin, scale) pair, so the same code serves a phone in portrait and a
// desktop in landscape -- only where the tray sits changes.

import { extent, outlinePolygon, insetPolygon, interiorSegments } from './sudoku.js';
import { glyph } from './categories.js';

export const PALETTE = {
  table: '#e9e4d8',
  boardPaper: '#faf8f2',
  piecePaper: '#fffdf6',
  ink: '#16130e',
  clueTint: '#ded7c5',
  red: '#a5312a',
  muted: '#6b6355',
};

const SERIF = 'Georgia, "Times New Roman", Times, serif';
const EMOJI_FONT =
  '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla","EmojiOne Color",sans-serif';

// Icons are the only expensive thing on screen, so each glyph is rasterised
// once and blitted thereafter. 54 sprites covers every category x variant.
const SPRITE = 112;
const spriteCache = new Map();

function iconSprite(v, k) {
  const key = `${v}:${k}`;
  let cv = spriteCache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = cv.height = SPRITE;
  const c = cv.getContext('2d');
  c.font = `${Math.round(SPRITE * 0.7)}px ${EMOJI_FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(glyph(v, k), SPRITE / 2, SPRITE * 0.55);
  spriteCache.set(key, cv);
  return cv;
}

function paperTile(color, amount = 20) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.fillStyle = color;
  c.fillRect(0, 0, S, S);
  const img = c.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  c.putImageData(img, 0, 0);
  c.fillStyle = 'rgba(60,50,35,0.09)';
  for (let i = 0; i < S * 1.2; i++) c.fillRect(Math.random() * S, Math.random() * S, 1, 1);
  return cv;
}

/** Closed path through pts with the corners softened -- concave ones too. */
function polyPath(ctx, pts, r) {
  const n = pts.length;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const d1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1;
    const d2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]) || 1;
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const a = [cur[0] + ((prev[0] - cur[0]) / d1) * rr, cur[1] + ((prev[1] - cur[1]) / d1) * rr];
    const b = [cur[0] + ((next[0] - cur[0]) / d2) * rr, cur[1] + ((next[1] - cur[1]) / d2) * rr];
    if (i === 0) ctx.moveTo(a[0], a[1]);
    else ctx.lineTo(a[0], a[1]);
    ctx.quadraticCurveTo(cur[0], cur[1], b[0], b[1]);
  }
  ctx.closePath();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.cssW = 1;
    this.cssH = 1;

    this.tableTile = paperTile(PALETTE.table, 16);
    this.boardTile = paperTile(PALETTE.boardPaper, 18);
    this.pieceTile = paperTile(PALETTE.piecePaper, 22);
    this.tablePat = this.ctx.createPattern(this.tableTile, 'repeat');
    this.boardPat = this.ctx.createPattern(this.boardTile, 'repeat');
    this.piecePat = this.ctx.createPattern(this.pieceTile, 'repeat');

    this.game = null;
    this.pieceViews = [];
    this.heldId = null;
    this.ghost = null;
    this.bad = new Set();

    // world -> screen
    this.S = 40;
    this.ox = 0;
    this.oy = 0;
  }

  // --- puzzle build --------------------------------------------------------

  setPuzzle(game) {
    this.game = game;
    this.rules = game.rules;
    this.heldId = null;
    this.ghost = null;
    this.pieceViews = game.pieces.map((p) => {
      const pv = { id: p.id, pos: { x: 0, y: 0, s: 0.5, lift: 0 }, target: null };
      this.rebuildPiece(pv, game.cellsOf(p));
      return pv;
    });
    this.resize();
    for (const p of game.pieces) this.syncPiece(p, true);
    this.refresh(game);
  }

  rebuildPiece(pv, cells) {
    pv.cells = cells;
    pv.cellSet = new Set(cells.map((c) => `${c.r},${c.c}`));
    pv.ext = extent(cells);
    // y is row, x is col, so the polygon helpers hand back [col, row] pairs
    pv.outline = insetPolygon(outlinePolygon(cells), 0.055);
    pv.segs = interiorSegments(cells);
  }

  // --- layout --------------------------------------------------------------

  /**
   * Pack the tray across its short side and let it run off the long one, which
   * is what makes the strip scrollable: in portrait that is columns filling
   * downward and continuing rightward, in landscape rows the other way about.
   * Returns the slots and how far the content reaches along the scroll axis.
   */
  packTray(scale, tray, axis, caption, pad) {
    const gap = 0.24;
    const order = this.game.pieces
      .map((p) => ({ p, e: extent(p.base) }))
      .sort((a, b) => b.e.h - a.e.h || b.e.w - a.e.w);

    const slots = new Map();
    let x = tray.x + pad;
    let y = tray.y + caption;
    let band = 0;
    for (const { p, e } of order) {
      const w = e.w * scale;
      const h = e.h * scale;
      if (axis === 'x') {
        if (y > tray.y + caption && y + h > tray.y + tray.h - pad) {
          y = tray.y + caption;
          x += band + gap;
          band = 0;
        }
        slots.set(p.id, { x, y });
        y += h + gap;
        band = Math.max(band, w);
      } else {
        if (x > tray.x + pad && x + w > tray.x + tray.w - pad) {
          x = tray.x + pad;
          y += band + gap;
          band = 0;
        }
        slots.set(p.id, { x, y });
        x += w + gap;
        band = Math.max(band, h);
      }
    }
    const length = axis === 'x' ? x + band + pad - tray.x : y + band + pad - tray.y;
    return { slots, length };
  }

  /**
   * The board gets a guaranteed share of the screen and the tray takes what is
   * left, scrolling rather than growing. Sizing the tray to hold every piece at
   * once was what used to squeeze the board on a phone -- twenty pieces meant a
   * tray half the height of the screen, and squares too small to hit.
   */
  layout() {
    if (!this.game) return;
    const N = this.rules.N;
    const cw = this.cssW;
    const ch = this.cssH;
    const margin = 6;
    const availW = Math.max(1, cw - 2 * margin);
    const availH = Math.max(1, ch - 2 * margin);
    const portrait = cw / ch < 1.15;
    const gap = portrait ? 0.4 : 0.6;

    let S;
    let tray;
    let axis;
    if (portrait) {
      // never let the board fall below 62% of the height
      S = Math.max(1, Math.min(availW / N, (availH * 0.62) / N));
      tray = { x: 0, y: N + gap, w: N, h: Math.max(2.4, availH / S - N - gap) };
      axis = 'x';
    } else {
      const byHeight = availH / N;
      let trayW = availW / byHeight - N - gap;
      if (trayW < 3.4) {
        S = Math.max(1, availW / (N + gap + 3.4));
        trayW = 3.4;
      } else {
        S = Math.max(1, byHeight);
        trayW = Math.min(trayW, N * 0.85);
      }
      tray = { x: N + gap, y: 0, w: trayW, h: N };
      axis = 'y';
    }

    // Tray squares want about 26px so a fingertip can find them; that is a
    // floor, not a target. Above it, take the largest size whose pieces all fit
    // in view, so a roomy screen shows big tiles and no scrollbar, and only a
    // cramped one has to scroll.
    const caption = 0.78;
    const pad = 0.28;
    const across = axis === 'x' ? tray.h - caption - pad : tray.w - 2 * pad;
    const window = axis === 'x' ? tray.w : tray.h;
    const floor = Math.min(0.78, Math.max(0.34, 26 / S), across / 4);

    let ts = floor;
    let packed = null;
    for (const cand of [0.78, 0.72, 0.66, 0.6, 0.54, 0.48, 0.42, 0.38]) {
      if (cand < floor || cand > across / 4) continue;
      const trial = this.packTray(cand, tray, axis, caption, pad);
      if (trial.length <= window) {
        ts = cand;
        packed = trial;
        break;
      }
    }
    if (!packed) packed = this.packTray(ts, tray, axis, caption, pad);

    this.S = S;
    this.trayScale = ts;
    this.tray = tray;
    this.trayAxis = axis;
    this.trayCaption = caption;
    this.slots = packed.slots;
    this.trayLength = packed.length;
    this.trayWindow = axis === 'x' ? tray.w : tray.h;
    this.maxScroll = Math.max(0, packed.length - this.trayWindow);
    this.trayScroll = Math.min(this.trayScroll || 0, this.maxScroll);

    const W = portrait ? N : tray.x + tray.w;
    const H = portrait ? tray.y + tray.h : Math.max(N, tray.h);
    this.ox = (cw - W * S) / 2;
    this.oy = (ch - H * S) / 2;
  }

  /** Pan the tray strip. Returns whether anything actually moved. */
  setTrayScroll(value) {
    const next = Math.max(0, Math.min(this.maxScroll, value));
    if (next === this.trayScroll) return false;
    this.trayScroll = next;
    for (const p of this.game.pieces) {
      if (!p.placed && p.id !== this.heldId) this.syncPiece(p, true);
    }
    return true;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, Math.round(rect.width));
    this.cssH = Math.max(1, Math.round(rect.height));
    this.dpr = Math.min(devicePixelRatio || 1, 2.5);
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.layout();
    // the carried piece is anchored to the pointer, not to a slot, so leave it be
    if (this.game) {
      for (const p of this.game.pieces) {
        if (p.id !== this.heldId) this.syncPiece(p, true);
      }
    }
  }

  // --- per-frame state -----------------------------------------------------

  syncPiece(piece, immediate = false) {
    const pv = this.pieceViews[piece.id];
    if (!pv || !this.slots) return;
    if (piece.placed) {
      pv.target = { x: piece.c, y: piece.r, s: 1, lift: 0 };
    } else {
      const slot = this.slots.get(piece.id) ?? { x: this.tray.x, y: this.tray.y };
      const shift = this.trayScroll || 0;
      pv.target = {
        x: slot.x - (this.trayAxis === 'x' ? shift : 0),
        y: slot.y - (this.trayAxis === 'y' ? shift : 0),
        s: this.trayScale,
        lift: 0,
      };
    }
    if (immediate) pv.pos = { ...pv.target };
  }

  setHeld(pieceId, x, y) {
    this.heldId = pieceId;
    if (pieceId == null) return;
    this.pieceViews[pieceId].target = { x, y, s: 1, lift: 1 };
  }

  /**
   * A carried piece sits directly on its landing squares, so the interesting
   * feedback is the outline peeking out from under it: dashed where it fits,
   * solid red squares where something is in the way.
   */
  setGhost(cells, ok) {
    this.ghost = cells ? { cells, ok } : null;
  }

  refresh(game) {
    this.bad = game.conflicts();
  }

  update(dt) {
    const k = 1 - Math.pow(0.0009, dt);
    let moving = false;
    for (const pv of this.pieceViews) {
      if (!pv.target) continue;
      for (const key of ['x', 'y', 's', 'lift']) {
        const d = pv.target[key] - pv.pos[key];
        if (Math.abs(d) > 0.0008) {
          pv.pos[key] += d * k;
          moving = true;
        } else {
          pv.pos[key] = pv.target[key];
        }
      }
    }
    return moving;
  }

  // --- drawing -------------------------------------------------------------

  px(x) {
    return this.ox + x * this.S;
  }
  py(y) {
    return this.oy + y * this.S;
  }

  icon(ctx, v, k, cx, cy, size) {
    if (!v) return;
    ctx.drawImage(iconSprite(v, k), cx - size / 2, cy - size / 2, size, size);
  }

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = this.tablePat;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    if (!this.game) return;

    this.drawTray(ctx);
    this.drawBoard(ctx);
    this.drawGhost(ctx);

    // Tray pieces are clipped so a scrolled-away piece cannot show up outside
    // the strip. The clip is loosened on the other axis, so a piece flying home
    // from the board is not chopped off mid-flight.
    const S = this.S;
    const t = this.tray;
    const slack = 0.6;
    ctx.save();
    ctx.beginPath();
    if (this.trayAxis === 'x') {
      ctx.rect(this.px(t.x), this.py(t.y - slack), t.w * S, (t.h + slack) * S);
    } else {
      ctx.rect(this.px(t.x - slack), this.py(t.y), (t.w + slack) * S, t.h * S);
    }
    ctx.clip();
    for (const pv of this.pieceViews) {
      if (pv.id !== this.heldId && !this.game.pieces[pv.id].placed) this.drawPiece(ctx, pv);
    }
    ctx.restore();

    for (const pv of this.pieceViews) {
      if (pv.id !== this.heldId && this.game.pieces[pv.id].placed) this.drawPiece(ctx, pv);
    }
    if (this.heldId != null) this.drawPiece(ctx, this.pieceViews[this.heldId]);
    this.drawScrollBar(ctx);
  }

  /** A hint that the strip runs past its window, and how far along you are. */
  drawScrollBar(ctx) {
    if (this.maxScroll <= 0.001) return;
    const S = this.S;
    const t = this.tray;
    const along = this.trayWindow / this.trayLength;
    const at = this.trayScroll / this.trayLength;
    const thick = Math.max(3, S * 0.07);
    const inset = S * 0.25;

    ctx.save();
    ctx.fillStyle = PALETTE.ink;
    if (this.trayAxis === 'x') {
      const trackW = t.w * S - 2 * inset;
      const y = this.py(t.y + t.h) - thick - inset * 0.5;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(this.px(t.x) + inset, y, trackW, thick);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(this.px(t.x) + inset + trackW * at, y, trackW * along, thick);
    } else {
      const trackH = t.h * S - 2 * inset;
      const x = this.px(t.x + t.w) - thick - inset * 0.5;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(x, this.py(t.y) + inset, thick, trackH);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x, this.py(t.y) + inset + trackH * at, thick, trackH * along);
    }
    ctx.restore();
  }

  drawBoard(ctx) {
    const R = this.rules;
    const N = R.N;
    const S = this.S;
    const x0 = this.px(0);
    const y0 = this.py(0);
    const side = N * S;

    ctx.save();
    ctx.shadowColor = 'rgba(28,24,17,0.18)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = this.boardPat;
    ctx.fillRect(x0, y0, side, side);
    ctx.restore();

    // clue squares are sunk into the paper
    for (const cl of this.game.clues) {
      if (!this.game.isClueVisible(cl.i)) continue;
      const cx = x0 + cl.c * S;
      const cy = y0 + cl.r * S;
      ctx.fillStyle = PALETTE.clueTint;
      ctx.fillRect(cx, cy, S, S);
    }

    // Hairlines between squares, heavy strokes wherever two areas meet. Walking
    // the shared edges rather than the column indices is what lets an irregular
    // board draw itself with the same code as a rectangular one.
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineCap = 'butt';
    ctx.lineWidth = Math.max(1, S * 0.018);
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let k = 1; k < N; k++) {
      ctx.moveTo(x0 + k * S, y0);
      ctx.lineTo(x0 + k * S, y0 + side);
      ctx.moveTo(x0, y0 + k * S);
      ctx.lineTo(x0 + side, y0 + k * S);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    const boxOf = this.game.regions.boxOf;
    ctx.lineWidth = Math.max(2, S * 0.055);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < R.cells; i++) {
      const r = R.row(i);
      const c = R.col(i);
      if (c < N - 1 && boxOf[i] !== boxOf[i + 1]) {
        ctx.moveTo(x0 + (c + 1) * S, y0 + r * S);
        ctx.lineTo(x0 + (c + 1) * S, y0 + (r + 1) * S);
      }
      if (r < N - 1 && boxOf[i] !== boxOf[i + N]) {
        ctx.moveTo(x0 + c * S, y0 + (r + 1) * S);
        ctx.lineTo(x0 + (c + 1) * S, y0 + (r + 1) * S);
      }
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.strokeRect(x0, y0, side, side);

    for (const cl of this.game.clues) {
      if (!this.game.isClueVisible(cl.i)) continue;
      const cx = x0 + cl.c * S;
      const cy = y0 + cl.r * S;
      if (this.bad.has(cl.i)) this.markBad(ctx, cx, cy, S);
      this.icon(ctx, cl.v, cl.k, cx + S / 2, cy + S / 2, S * 0.72);
    }
  }

  markBad(ctx, x, y, u) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = PALETTE.red;
    roundRect(ctx, x + u * 0.06, y + u * 0.06, u * 0.88, u * 0.88, u * 0.16);
    ctx.fill();
    ctx.restore();
  }

  drawTray(ctx) {
    const t = this.tray;
    const S = this.S;
    const x = this.px(t.x);
    const y = this.py(t.y);
    const w = t.w * S;
    const h = t.h * S;

    ctx.fillStyle = this.boardPat;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = Math.max(1.2, S * 0.035);
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);

    const cap = Math.max(9, Math.min(14, S * 0.3));
    const left = this.game.pieces.filter((p) => !p.placed).length;
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `600 ${cap}px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.letterSpacing = `${(cap * 0.3).toFixed(1)}px`;
    ctx.fillText(left ? `${left} TO PLACE` : 'TRAY EMPTY', x + w / 2, y + cap * 1.2);
    ctx.restore();

    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + S * 0.25, y + cap * 2.1);
    ctx.lineTo(x + w - S * 0.25, y + cap * 2.1);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawGhost(ctx) {
    if (!this.ghost) return;
    const { cells, ok } = this.ghost;
    const N = this.rules.N;
    const S = this.S;
    const inside = cells.filter((c) => c.r >= 0 && c.r < N && c.c >= 0 && c.c < N);

    if (!ok) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = PALETTE.red;
      for (const c of inside) ctx.fillRect(this.px(c.c), this.py(c.r), S, S);
      ctx.restore();
      return;
    }
    if (inside.length !== cells.length) return;

    const pts = outlinePolygon(cells).map(([cx, cy]) => [this.px(cx), this.py(cy)]);
    ctx.save();
    ctx.strokeStyle = PALETTE.ink;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1.5, S * 0.05);
    ctx.setLineDash([S * 0.18, S * 0.14]);
    polyPath(ctx, pts, 2);
    ctx.stroke();
    ctx.restore();
  }

  drawPiece(ctx, pv) {
    const piece = this.game.pieces[pv.id];
    const { x, y, s, lift } = pv.pos;
    const u = s * this.S; // pixels per cell for this piece
    const X = this.px(x);
    const Y = this.py(y);
    const pts = pv.outline.map(([a, b]) => [X + a * u, Y + b * u]);
    const radius = u * 0.11;
    const invalid = pv.id === this.heldId && this.ghost && !this.ghost.ok;

    ctx.save();
    ctx.shadowColor = `rgba(28,24,17,${(0.2 + 0.16 * lift).toFixed(3)})`;
    ctx.shadowBlur = 3 + 20 * lift;
    ctx.shadowOffsetY = 1.5 + 10 * lift;
    polyPath(ctx, pts, radius);
    ctx.fillStyle = this.piecePat;
    ctx.fill();
    ctx.restore();

    if (invalid) {
      ctx.save();
      polyPath(ctx, pts, radius);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = PALETTE.red;
      ctx.fill();
      ctx.restore();
    } else if (pv.id === this.heldId) {
      ctx.save();
      polyPath(ctx, pts, radius);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#ffe9b8';
      ctx.fill();
      ctx.restore();
    }

    polyPath(ctx, pts, radius);
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = Math.max(1, u * 0.035);
    ctx.stroke();

    if (pv.segs.length) {
      ctx.save();
      ctx.strokeStyle = PALETTE.ink;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = Math.max(0.7, u * 0.022);
      ctx.beginPath();
      for (const [a, b] of pv.segs) {
        const dx = Math.sign(b[0] - a[0]) * 0.12;
        const dy = Math.sign(b[1] - a[1]) * 0.12;
        ctx.moveTo(X + (a[0] + dx) * u, Y + (a[1] + dy) * u);
        ctx.lineTo(X + (b[0] - dx) * u, Y + (b[1] - dy) * u);
      }
      ctx.stroke();
      ctx.restore();
    }

    for (const cell of pv.cells) {
      const cx = X + cell.c * u;
      const cy = Y + cell.r * u;
      if (piece.placed && pv.id !== this.heldId) {
        const i = this.rules.idx(piece.r + cell.r, piece.c + cell.c);
        if (this.bad.has(i)) this.markBad(ctx, cx, cy, u);
      }
      this.icon(ctx, cell.v, cell.k, cx + u / 2, cy + u / 2, u * 0.72);
    }
  }

  // --- input helpers -------------------------------------------------------

  /** World x/y (in cell units) under a pointer event. */
  pointerWorld(ev) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left - this.ox) / this.S,
      y: (ev.clientY - r.top - this.oy) / this.S,
    };
  }

  /** Topmost piece under a world point; tol adds fingertip slack in cells. */
  pickPiece(wx, wy, tol = 0) {
    for (let pass = 0; pass < 2; pass++) {
      const slack = pass === 0 ? 0 : tol;
      for (let i = this.pieceViews.length - 1; i >= 0; i--) {
        const pv = this.pieceViews[i];
        const lx = (wx - pv.pos.x) / pv.pos.s;
        const ly = (wy - pv.pos.y) / pv.pos.s;
        for (const cell of pv.cells) {
          if (
            lx >= cell.c - slack &&
            lx < cell.c + 1 + slack &&
            ly >= cell.r - slack &&
            ly < cell.r + 1 + slack
          ) {
            return pv.id;
          }
        }
      }
      if (!tol) break;
    }
    return null;
  }

  onBoard(x, y) {
    const N = this.rules.N;
    return x >= 0 && x < N && y >= 0 && y < N;
  }

  onTray(x, y) {
    const t = this.tray;
    return x >= t.x - 0.4 && x <= t.x + t.w + 0.4 && y >= t.y - 0.4 && y <= t.y + t.h + 0.4;
  }
}
