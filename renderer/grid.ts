/* Finds the tower's 6 cells in a picture by their frames (a black line next to a light red-brown border),
 * so the cut-outs sit exactly on the cells even when the game is a few pixels off the known layout.
 * Pure functions on RGBA pixels (tests/grid.test.ts).
 */
import type { Img } from './recognize';

/** the game's tower at 1915×1079: cell size and distance between cells */
const CELL_W = 163,
  CELL_H = 159,
  PITCH_X = 196.5,
  PITCH_Y = 196;

const frame = (d: Img['data'], i: number) => {
  const r = d[i]!,
    g = d[i + 1]!,
    b = d[i + 2]!;
  return r > 115 && r - b > 35 && r - g > 12 && g > 55;
};
const dark = (d: Img['data'], i: number) => d[i]! + d[i + 1]! + d[i + 2]! < 150;

/** how strongly each column (x) / row (y) looks like a cell border line */
function profiles(img: Img): { col: Float32Array; row: Float32Array } {
  const col = new Float32Array(img.w),
    row = new Float32Array(img.h);
  const { w, h, data: d } = img;
  for (let y = 3; y < h - 3; y++)
    for (let x = 3; x < w - 3; x++) {
      const i = (y * w + x) * 4;
      if (!frame(d, i)) continue;
      // a vertical line: dark on its left or right; a horizontal line: dark above or below
      if (dark(d, i - 12) || dark(d, i + 12)) col[x]!++;
      if (dark(d, i - w * 12) || dark(d, i + w * 12)) row[y]!++;
    }
  return { col, row };
}

const near = (p: Float32Array, at: number) => {
  let m = 0;
  for (let k = Math.round(at) - 2; k <= Math.round(at) + 2; k++) if (k >= 0 && k < p.length) m = Math.max(m, p[k]!);
  return m;
};

/** best start and scale for a set of line offsets (in reference pixels) */
function fit(p: Float32Array, lines: number[], s0: number): { at: number; s: number; score: number } {
  let best = { at: 0, s: s0, score: -1 };
  for (let s = s0 * 0.9; s <= s0 * 1.1; s += s0 * 0.01) {
    const span = lines[lines.length - 1]! * s;
    for (let at = 0; at + span < p.length; at++) {
      let score = 0;
      for (const l of lines) score += near(p, at + l * s);
      if (score > best.score) best = { at, s, score };
    }
  }
  return best;
}

export interface Snap {
  /** cell boxes in the picture's pixels, row by row (top left first) */
  cells: { x: number; y: number; w: number; h: number }[];
  /** how clearly the frames were found (0..1) */
  quality: number;
}

/**
 * @param img  a picture around the tower (a bit bigger than it)
 * @param scale  expected size: picture pixels per reference pixel (from the layout)
 */
export function snapTower(img: Img, scale: number): Snap | null {
  const { col, row } = profiles(img);
  const xs = [0, CELL_W, PITCH_X, PITCH_X + CELL_W];
  const ys = [0, CELL_H, PITCH_Y, PITCH_Y + CELL_H, 2 * PITCH_Y, 2 * PITCH_Y + CELL_H];
  const fx = fit(col, xs, scale),
    fy = fit(row, ys, scale);
  // a line that runs along a whole cell scores about its length
  const quality = Math.min(1, Math.min(fx.score / (xs.length * CELL_H * 3 * fy.s), fy.score / (ys.length * CELL_W * 2 * fx.s)) * 2);
  if (quality < 0.25) return null;
  const cells = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 2; c++)
      cells.push({ x: fx.at + c * PITCH_X * fx.s, y: fy.at + r * PITCH_Y * fy.s, w: CELL_W * fx.s, h: CELL_H * fy.s });
  return { cells, quality };
}

/** the part of a cell the item sits in: without the frame and the signs at the top (cooldown, charges). Big items
 * (a wrench) fill almost the whole cell, so only a thin border is left out. */
export const innerCell = (c: { x: number; y: number; w: number; h: number }) => ({
  x: c.x + c.w * 0.05,
  y: c.y + c.h * 0.1,
  w: c.w * 0.9,
  h: c.h * 0.84,
});
