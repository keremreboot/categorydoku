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
   * Shelf-pack the tray for a given piece scale and tray box.
   * Returns the slots plus the tray height that scale needs.
   */
  packTray(scale, tx, ty, tw) {
    const order = this.game.pieces
      .map((p) => ({ p, e: extent(p.base) }))
      .sort((a, b) => b.e.h - a.e.h || b.e.w - a.e.w);

    const pad = 0.34;
    const gap = 0.26;
    const caption = 0.9; // room under the tray's rule for the label
    const slots = new Map();
    let x = tx + pad;
    let y = ty + caption;
    let rowH = 0;
    for (const { p, e } of order) {
      const w = e.w * scale;
      const h = e.h * scale;
      if (x > tx + pad && x + w > tx + tw - pad) {
        x = tx + pad;
        y += rowH + gap;
        rowH = 0;
      }
      slots.set(p.id, { x, y });
      x += w + gap;
      rowH = Math.max(rowH, h);
    }
    return { slots, h: y + rowH + pad - ty };
  }

  /**
   * Pick the tray scale and shape that leaves both the board squares and the
   * tray squares as large as possible. Board cells want ~40px for a fingertip,
   * tray cells a little less since you only have to hit them, not read them.
   */
  layout() {
    if (!this.game) return;
    const N = this.rules.N;
    const cw = this.cssW;
    const ch = this.cssH;
    const portrait = cw / ch < 1.15;
    const gap = portrait ? 0.5 : 0.75;
    const margin = 6;

    const scales = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.44, 0.38];
    const widths = portrait ? [N] : [N * 0.4, N * 0.5, N * 0.62, N * 0.78, N];

    let best = null;
    for (const ts of scales) {
      for (const tw of widths) {
        const tx = portrait ? 0 : N + gap;
        const ty = portrait ? N + gap : 0;
        const packed = this.packTray(ts, tx, ty, tw);
        const W = Math.max(N, tx + tw);
        const H = Math.max(N, ty + packed.h);
        // clamped so a collapsed (zero-sized) container cannot invert the scale
        const s = Math.max(1, Math.min((cw - 2 * margin) / W, (ch - 2 * margin) / H));
        const score = Math.min(s / 40, (s * ts) / 24);
        if (!best || score > best.score) {
          best = { score, s, ts, tx, ty, tw, th: packed.h, slots: packed.slots, W, H };
        }
      }
    }

    this.S = best.s;
    this.ox = (cw - best.W * best.s) / 2;
    this.oy = (ch - best.H * best.s) / 2;
    this.trayScale = best.ts;
    this.tray = { x: best.tx, y: best.ty, w: best.tw, h: best.th };
    this.slots = best.slots;
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
      pv.target = { x: slot.x, y: slot.y, s: this.trayScale, lift: 0 };
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

    for (const pv of this.pieceViews) if (pv.id !== this.heldId) this.drawPiece(ctx, pv);
    if (this.heldId != null) this.drawPiece(ctx, this.pieceViews[this.heldId]);
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

    ctx.strokeStyle = PALETTE.ink;
    ctx.lineCap = 'butt';
    const heavy = (k, span) => k === 0 || k === N || (R.hasBoxes && k % span === 0);
    const rule = (thick, ax, ay, bx, by) => {
      ctx.lineWidth = thick ? Math.max(2, S * 0.055) : Math.max(1, S * 0.018);
      ctx.globalAlpha = thick ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    };
    for (let k = 0; k <= N; k++) {
      rule(heavy(k, R.boxW), x0 + k * S, y0, x0 + k * S, y0 + side);
      rule(heavy(k, R.boxH), x0, y0 + k * S, x0 + side, y0 + k * S);
    }
    ctx.globalAlpha = 1;

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

    const cap = Math.max(9, Math.min(15, S * 0.32));
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `600 ${cap}px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = this.game.pieces.every((p) => p.placed) ? 'TRAY EMPTY' : 'THE PIECES';
    ctx.save();
    ctx.letterSpacing = `${(cap * 0.35).toFixed(1)}px`;
    ctx.fillText(label, x + w / 2, y + cap * 1.5);
    ctx.restore();

    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + S * 0.3, y + cap * 2.5);
    ctx.lineTo(x + w - S * 0.3, y + cap * 2.5);
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
