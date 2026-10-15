/* Item recognition: which item icon sits in a box cut out of a screenshot.
 * Pure functions on RGBA pixel arrays (tested in tests/recognize*.test.ts, tests/grid.test.ts).
 *
 * Each item icon is turned into templates at a few sizes (with its alpha as a mask). A slot is scaled to SLOT pixels
 * on its shorter side. Fast path: the item seen there before is checked alone (animations change pixels, not items).
 * Otherwise a coarse pass at half resolution finds the likely items with their size and place, and the fine pass
 * only searches around that. The score compares the colour error of the item with that of the empty background
 * (0 = identical, 1 = no better than an empty slot).
 */
export interface Img {
  w: number;
  h: number;
  /** RGBA */
  data: Uint8ClampedArray | Uint8Array;
}
interface Tpl {
  size: number;
  rgb: Float32Array;
  mask: Uint8Array;
  n: number;
}
export interface ItemTemplate {
  id: string;
  tpls: Tpl[];
  /** the same, mirrored left-right (the game draws items in your tower mirrored) */
  flip: Tpl[];
  /** half-size templates for the coarse pass */
  half: Tpl[];
  halfFlip: Tpl[];
}
/** which way the item pictures face in a box: shop = as drawn, tower = mirrored */
export type Facing = 'normal' | 'mirrored' | 'both';

export interface Match {
  id: string;
  score: number;
  /** score of the best other item (bigger gap = surer) */
  next: number;
  /** index of the template size that matched (the game draws all items at one scale: learnt by the caller) */
  size: number;
}
export interface IdentifyOptions {
  /** the item seen in this place last time: checked first, alone */
  prev?: string | null;
  /** template size indices to try (a learnt scale); all when missing */
  sizes?: number[];
  /** accept a clear best item a little above the limit (the tower: thin staffs, tooltips) */
  lenient?: boolean;
}

/** the shorter side of a slot is scaled to this size */
export const SLOT = 40;
/** visible sprite sizes tried inside a slot (the sprite fills about 30–90 % of its box) */
export const SIZES = [12, 15, 18, 21, 25, 29, 33, 37];
/** above this score the slot counts as empty / unknown */
export const MAX_SCORE = 0.9;
/** the best item must beat the second best by this much */
const MIN_GAP = 0.02;
/** candidates kept after the coarse pass */
const SHORTLIST = 14;
/** the fast path keeps the item seen before at this score or better */
const KEEP_SCORE = 0.85;

/** area-average resize (also handles upscaling) */
export function resize(src: Img, w: number, h: number): Img {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = src.w / w,
    sy = src.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy,
      y1 = Math.max(y0 + 1e-6, (y + 1) * sy);
    for (let x = 0; x < w; x++) {
      const x0 = x * sx,
        x1 = Math.max(x0 + 1e-6, (x + 1) * sx);
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        if (wy <= 0 || yy >= src.h) continue;
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          if (wx <= 0 || xx >= src.w) continue;
          const k = wx * wy,
            i = (yy * src.w + xx) * 4,
            al = src.data[i + 3]! / 255;
          // premultiplied, so transparent pixels do not bleed their colour
          r += src.data[i]! * al * k;
          g += src.data[i + 1]! * al * k;
          b += src.data[i + 2]! * al * k;
          a += al * k;
          wsum += k;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = wsum ? (a / wsum) * 255 : 0;
    }
  }
  return { w, h, data: out };
}

/** Windows screenshots come as BGRA */
export function bgraToRgba(d: Uint8Array | Uint8ClampedArray): Uint8ClampedArray {
  const o = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) {
    o[i] = d[i + 2]!;
    o[i + 1] = d[i + 1]!;
    o[i + 2] = d[i]!;
    o[i + 3] = 255;
  }
  return o;
}

/** cut a box (in pixels) out of an image */
export function crop(src: Img, x: number, y: number, w: number, h: number): Img {
  x = Math.max(0, Math.round(x));
  y = Math.max(0, Math.round(y));
  w = Math.max(1, Math.min(Math.round(w), src.w - x));
  h = Math.max(1, Math.min(Math.round(h), src.h - y));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(src.data.subarray(((y + r) * src.w + x) * 4, ((y + r) * src.w + x + w) * 4), r * w * 4);
  return { w, h, data: out };
}

/** split a box into cols × rows equal cells */
export function cells(src: Img, cols: number, rows: number): Img[] {
  const out: Img[] = [];
  const cw = src.w / cols,
    ch = src.h / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(crop(src, c * cw, r * ch, cw, ch));
  return out;
}

function mirror(t: Tpl): Tpl {
  const rgb = new Float32Array(t.rgb.length),
    mask = new Uint8Array(t.mask.length);
  for (let y = 0; y < t.size; y++)
    for (let x = 0; x < t.size; x++) {
      const a = y * t.size + x,
        b = y * t.size + (t.size - 1 - x);
      mask[b] = t.mask[a]!;
      rgb[b * 3] = t.rgb[a * 3]!;
      rgb[b * 3 + 1] = t.rgb[a * 3 + 1]!;
      rgb[b * 3 + 2] = t.rgb[a * 3 + 2]!;
    }
  return { size: t.size, rgb, mask, n: t.n };
}

export function makeTemplate(id: string, icon: Img): ItemTemplate {
  // trim the transparent border, so the size steps mean the visible sprite
  let x0 = icon.w,
    y0 = icon.h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < icon.h; y++)
    for (let x = 0; x < icon.w; x++)
      if (icon.data[(y * icon.w + x) * 4 + 3]! >= 128) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  const box = x1 < 0 ? icon : crop(icon, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  const side = Math.max(box.w, box.h);
  const build = (size: number): Tpl => {
    const w = Math.max(1, Math.round((box.w / side) * size)),
      h = Math.max(1, Math.round((box.h / side) * size));
    const r = resize(box, w, h);
    // square template, centred, rest masked out
    const rgb = new Float32Array(size * size * 3),
      mask = new Uint8Array(size * size);
    const ox = Math.floor((size - w) / 2),
      oy = Math.floor((size - h) / 2);
    let n = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4,
          p = (y + oy) * size + x + ox;
        if (r.data[i + 3]! < 160) continue;
        mask[p] = 1;
        rgb[p * 3] = r.data[i]!;
        rgb[p * 3 + 1] = r.data[i + 1]!;
        rgb[p * 3 + 2] = r.data[i + 2]!;
        n++;
      }
    return { size, rgb, mask, n };
  };
  const tpls = SIZES.map(build);
  const half = SIZES.map((sz) => build(Math.max(4, Math.round(sz / 2))));
  return { id, tpls, flip: tpls.map(mirror), half, halfFlip: half.map(mirror) };
}

/** the most common colour of the slot (the empty background; frames and the item are smaller areas) */
function background(slot: Img): [number, number, number] {
  const n = new Uint32Array(512),
    sum = new Float64Array(512 * 3);
  for (let i = 0; i < slot.data.length; i += 4) {
    const r = slot.data[i]!,
      g = slot.data[i + 1]!,
      b = slot.data[i + 2]!;
    const k = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    n[k]!++;
    sum[k * 3] += r;
    sum[k * 3 + 1] += g;
    sum[k * 3 + 2] += b;
  }
  let best = 0;
  for (let k = 1; k < 512; k++) if (n[k]! > n[best]!) best = k;
  const c = Math.max(1, n[best]!);
  return [sum[best * 3]! / c, sum[best * 3 + 1]! / c, sum[best * 3 + 2]! / c];
}

/** colour error of "background only" over the slot (inside the edge) */
function totalError(s: Img, bg: [number, number, number], edge: number): number {
  let total = 0;
  for (let y = edge; y < s.h - edge; y++)
    for (let x = edge; x < s.w - edge; x++) {
      const i = (y * s.w + x) * 4;
      total += Math.abs(s.data[i]! - bg[0]) + Math.abs(s.data[i + 1]! - bg[1]) + Math.abs(s.data[i + 2]! - bg[2]);
    }
  return total;
}

/** best placement of a template in the slot (inside `win` when given). The model "item here, background everywhere
 * else" is compared with "only background": score = model error ÷ background-only error (`total`). A thin item that
 * covers only part of a bigger one leaves the rest unexplained. */
function slide(
  slot: Img,
  t: Tpl,
  bg: [number, number, number],
  total: number,
  edge: number,
  win?: { x0: number; x1: number; y0: number; y1: number },
): { score: number; ox: number; oy: number } {
  const best = { score: Infinity, ox: 0, oy: 0 };
  const S = slot.w,
    d = slot.data,
    spanX = S - t.size,
    spanY = slot.h - t.size;
  if (spanX < 0 || spanY < 0 || !t.n || total <= 0) return best;
  const x0 = Math.max(0, win?.x0 ?? 0),
    x1 = Math.min(spanX, win?.x1 ?? spanX),
    y0 = Math.max(0, win?.y0 ?? 0),
    y1 = Math.min(spanY, win?.y1 ?? spanY);
  for (let oy = y0; oy <= y1; oy++)
    for (let ox = x0; ox <= x1; ox++) {
      let err = 0,
        vsBg = 0;
      for (let y = 0; y < t.size; y++) {
        const sy = oy + y;
        if (sy < edge || sy >= slot.h - edge) continue;
        const row = sy * S + ox;
        for (let x = 0; x < t.size; x++) {
          const p = y * t.size + x;
          if (!t.mask[p]) continue;
          const sx = ox + x;
          if (sx < edge || sx >= S - edge) continue;
          const i = (row + x) * 4;
          const r = d[i]!,
            g = d[i + 1]!,
            b = d[i + 2]!;
          err += Math.abs(r - t.rgb[p * 3]!) + Math.abs(g - t.rgb[p * 3 + 1]!) + Math.abs(b - t.rgb[p * 3 + 2]!);
          vsBg += Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
        }
      }
      const sc = (total - vsBg + err) / total;
      if (sc < best.score) {
        best.score = sc;
        best.ox = ox;
        best.oy = oy;
      }
    }
  return best;
}

/** best item for one slot, or null when nothing fits (empty slot, sold, unknown art) */
export function identify(
  slot: Img,
  items: ItemTemplate[],
  maxScore = MAX_SCORE,
  facing: Facing = 'normal',
  opt: IdentifyOptions = {},
): Match | null {
  const full = (it: ItemTemplate): Tpl[] => (facing === 'mirrored' ? it.flip : it.tpls);
  const halfs = (it: ItemTemplate): Tpl[] => (facing === 'mirrored' ? it.halfFlip : it.half);
  if (facing === 'both') {
    const a = identify(slot, items, maxScore, 'normal', opt),
      b = identify(slot, items, maxScore, 'mirrored', opt);
    return !a ? b : !b ? a : a.score <= b.score ? a : b;
  }
  const allowed = (opt.sizes?.length ? opt.sizes : SIZES.map((_, i) => i)).filter((i) => i >= 0 && i < SIZES.length);
  // the shorter side becomes SLOT pixels, the aspect stays (a slot may hold a price tag under the icon)
  const k = SLOT / Math.min(slot.w, slot.h);
  const s = resize(slot, Math.min(SLOT * 2, Math.round(slot.w * k)), Math.min(SLOT * 2, Math.round(slot.h * k)));
  const bg = background(s);
  // the outer edge (slot frame, rarity border) is left out
  const edge = 3;
  const total = totalError(s, bg, edge);
  // an (almost) flat slot is empty
  if (total < s.w * s.h * 6) return null;

  // fast path: still the same item?
  if (opt.prev) {
    const it = items.find((x) => x.id === opt.prev);
    if (it) {
      let best = { score: Infinity, size: 0 };
      for (const i of allowed) {
        const r = slide(s, full(it)[i]!, bg, total, edge);
        if (r.score < best.score) best = { score: r.score, size: i };
      }
      if (best.score <= KEEP_SCORE) return { id: it.id, score: best.score, next: Infinity, size: best.size };
    }
  }

  // coarse pass at half resolution: score, size and place per item
  const h = resize(s, Math.max(4, Math.round(s.w / 2)), Math.max(4, Math.round(s.h / 2)));
  const totalH = totalError(h, bg, 1);
  const short = items
    .map((it) => {
      let best = { score: Infinity, k: allowed[0]!, ox: 0, oy: 0 };
      for (const i of allowed) {
        const r = slide(h, halfs(it)[i]!, bg, totalH, 1);
        if (r.score < best.score) best = { score: r.score, k: i, ox: r.ox, oy: r.oy };
      }
      return { it, ...best };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, SHORTLIST);

  // fine pass: only around the coarse size and place
  const scored = short
    .map(({ it, k: ck, ox, oy }) => {
      const hs = halfs(it)[ck]!.size;
      // centre of the coarse find, in full pixels
      const cx = (ox + hs / 2) * 2,
        cy = (oy + hs / 2) * 2;
      let best = { score: Infinity, size: ck };
      for (const kk of [ck - 1, ck, ck + 1]) {
        if (!allowed.includes(kk)) continue;
        const t = full(it)[kk]!;
        const bx = Math.round(cx - t.size / 2),
          by = Math.round(cy - t.size / 2);
        const r = slide(s, t, bg, total, edge, { x0: bx - 3, x1: bx + 3, y0: by - 3, y1: by + 3 });
        if (r.score < best.score) best = { score: r.score, size: kk };
      }
      return { id: it.id, ...best };
    })
    .sort((a, b) => a.score - b.score);
  const top = scored[0];
  // unknown when it explains too little, or when the runner-up is just as good
  // a little above the limit is still fine when no other item comes close (thin items, a tooltip over a corner)
  const gap = (scored[1]?.score ?? Infinity) - (top?.score ?? 0);
  const limit = opt.lenient ? maxScore + 0.05 : maxScore;
  if (!top || top.score > limit || (top.score > maxScore && gap < 0.08) || gap < MIN_GAP) return null;
  return { id: top.id, score: top.score, next: scored[1]?.score ?? Infinity, size: top.size };
}
