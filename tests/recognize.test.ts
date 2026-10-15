import { describe, expect, it } from 'vitest';
import { cells, identify, makeTemplate, type Img } from '../renderer/recognize';

/** a seeded pixel-art icon: 8×8 colour blocks with a transparent rim, like the game sprites */
function sprite(seed: number, size = 32): Img {
  let s = seed * 9301 + 49297;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const blocks = Array.from({ length: 64 }, () => [rnd() * 255, rnd() * 255, rnd() * 255, rnd() < 0.8 ? 255 : 0]);
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const bx = Math.floor((x / size) * 8),
        by = Math.floor((y / size) * 8);
      const rim = bx === 0 || by === 0 || bx === 7 || by === 7;
      const c = blocks[by * 8 + bx]!;
      data.set([c[0]!, c[1]!, c[2]!, rim ? 0 : c[3]!], (y * size + x) * 4);
    }
  return { w: size, h: size, data };
}

/** a "screen" box: brown background, the sprite drawn nearest-neighbour at `px` pixels, light noise */
function slotWith(icon: Img | null, w: number, h: number, px: number, ox: number, oy: number): Img {
  const data = new Uint8ClampedArray(w * h * 4);
  let n = 7;
  for (let i = 0; i < w * h; i++) {
    n = (n * 1103515245 + 12345) % 2147483648;
    const j = (n % 9) - 4;
    data.set([70 + j, 48 + j, 30 + j, 255], i * 4);
  }
  if (icon)
    for (let y = 0; y < px; y++)
      for (let x = 0; x < px; x++) {
        const sx = Math.floor((x / px) * icon.w),
          sy = Math.floor((y / px) * icon.h);
        const i = (sy * icon.w + sx) * 4;
        if (icon.data[i + 3]! < 128) continue;
        const o = ((oy + y) * w + ox + x) * 4;
        data.set([icon.data[i]!, icon.data[i + 1]!, icon.data[i + 2]!, 255], o);
      }
  return { w, h, data };
}

describe('item recognition', () => {
  const icons = Array.from({ length: 80 }, (_, i) => sprite(i + 1));
  const items = icons.map((ic, i) => makeTemplate('item' + i, ic));

  it('finds the right icon at different sizes and positions', () => {
    const cases = [
      [3, 64, 64, 48, 8, 6],
      [17, 90, 110, 70, 10, 20],
      [42, 40, 40, 30, 5, 4],
      [79, 120, 100, 80, 30, 6],
    ] as const;
    for (const [k, w, h, px, ox, oy] of cases) {
      const m = identify(slotWith(icons[k]!, w, h, px, ox, oy), items);
      expect(m?.id).toBe('item' + k);
      expect(m!.next).toBeGreaterThan(m!.score);
    }
  });

  it('says nothing for an empty slot', () => {
    expect(identify(slotWith(null, 64, 64, 0, 0, 0), items)).toBeNull();
  });

  it('splits a shop row into slots', () => {
    const row = slotWith(null, 300, 60, 0, 0, 0);
    const parts = cells(row, 5, 1);
    expect(parts).toHaveLength(5);
    expect(parts[0]!.w).toBe(60);
  });
});
