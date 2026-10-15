import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { ITEMS } from '../shared/src/data/items';
import { slug } from '../shared/src/data/slug';
import { identify, makeTemplate, type Img, type ItemTemplate } from '../renderer/recognize';
import { readPng } from './png';

/** draw an icon nearest-neighbour into a game-like slot: dark wood, a rarity frame, some noise */
function gameSlot(icon: Img, size: number, iconPx: number, dx = 0, dy = 0): Img {
  const data = new Uint8ClampedArray(size * size * 4);
  let n = 11;
  for (let i = 0; i < size * size; i++) {
    n = (n * 1103515245 + 12345) % 2147483648;
    const j = (n % 11) - 5;
    const x = i % size,
      y = Math.floor(i / size);
    const frame = x < 3 || y < 3 || x >= size - 3 || y >= size - 3;
    data.set(frame ? [90, 143, 208, 255] : [44 + j, 32 + j, 25 + j, 255], i * 4);
  }
  const ox = Math.floor((size - iconPx) / 2) + dx,
    oy = Math.floor((size - iconPx) / 2) + dy;
  for (let y = 0; y < iconPx; y++)
    for (let x = 0; x < iconPx; x++) {
      const s = (Math.floor((y / iconPx) * icon.h) * icon.w + Math.floor((x / iconPx) * icon.w)) * 4;
      const a = icon.data[s + 3]! / 255;
      if (a < 0.05) continue;
      const o = ((oy + y) * size + ox + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = icon.data[s + c]! * a + data[o + c]! * (1 - a);
    }
  return { w: size, h: size, data };
}

describe('item recognition with the real item pictures', () => {
  const icons: { id: string; img: Img }[] = [];
  for (const it of ITEMS) {
    const f = 'shared/public/img/' + slug(it.name) + '.png';
    if (!existsSync(f)) continue;
    try {
      icons.push({ id: it.id, img: readPng(f) });
    } catch {
      /* unusual png, skipped */
    }
  }
  const items: ItemTemplate[] = icons.map((x) => makeTemplate(x.id, x.img));

  it('knows (nearly) every item in a shop-like slot', () => {
    expect(icons.length).toBeGreaterThan(150);
    const wrong: string[] = [],
      unknown: string[] = [];
    icons.forEach((x, i) => {
      const size = 70 + (i % 4) * 15;
      const m = identify(gameSlot(x.img, size, Math.round(size * (0.6 + (i % 3) * 0.1)), (i % 5) - 2, (i % 3) - 1), items);
      if (!m) unknown.push(x.id);
      else if (m.id !== x.id) wrong.push(x.id + '→' + m.id);
    });
    // never a wrong item; a few look-alikes may stay unknown
    expect(wrong).toEqual([]);
    expect(unknown.length / icons.length, unknown.join(', ')).toBeLessThan(0.03);
  }, 120000);
});
