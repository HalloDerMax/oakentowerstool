import { describe, expect, it } from 'vitest';
import { ITEMS } from '../shared/src/data/items';
import { slug } from '../shared/src/data/slug';
import { innerCell, snapTower } from '../renderer/grid';
import { crop, identify, makeTemplate, type Img } from '../renderer/recognize';
import { readPng } from './png';

const items = ITEMS.map((it) => makeTemplate(it.id, readPng('shared/public/img/' + slug(it.name) + '.png')));
const read = (img: Img, c: { x: number; y: number; w: number; h: number }) => {
  const r = innerCell(c);
  return identify(crop(img, r.x, r.y, r.w, r.h), items, undefined, 'mirrored')?.id ?? null;
};

describe('tower cells found by their frames', () => {
  // cut-outs around the tower of two real screens, moved by up to 30 px (the game is never exactly where we think)
  for (const [file, want] of [
    ['tower1.png', ['refined_spear', 'wildfire', null, null, null, null]],
    ['tower2.png', ['sharpsteel', 'dragonbone', 'bone_club', 'bio_bomb', 'eclipse', 'novice_blade']],
    // a poison slot (green frame), stars, a tooltip over the right column
    ['tower3.png', ['how_to_grow', 'petal_staff', null, 'elven_shield', 'refined_spear', 'hook']],
    // a big wrench that fills its cell, a charges counter in the cell
    ['tower4.png', ['wrench', 'rusty_cleaver', 'honing_steel', 'bio_bomb', 'warrior_shield', 'nightquill']],
  ] as const)
    for (const [dx, dy] of [
      [0, 0],
      [25, -20],
      [-30, 30],
    ])
      it(
        file + ' moved ' + dx + ',' + dy,
        () => {
          const src = readPng('tests/fixtures/screens/' + file);
          const img = crop(src, 30 + dx, 30 + dy, src.w - 60, src.h - 60);
          const s = snapTower(img, 1);
          expect(s).not.toBeNull();
          expect(s!.cells.map((c) => read(img, c))).toEqual(want);
        },
        60000,
      );

  it('a starred item with sparkles and two signs is still known', () => {
    const img = crop(readPng('tests/fixtures/screens/tower1.png'), 30, 30, 420, 600);
    const s = snapTower(img, 1)!;
    const c = s.cells[0]!;
    const set = (x: number, y: number, rgb: number[]) => img.data.set([...rgb, 255], (Math.round(y) * img.w + Math.round(x)) * 4);
    // green sparkles along the frame
    for (let k = 0; k < 160; k++) {
      const t = k / 160;
      for (const [x, y] of [
        [c.x + 4 + (k % 3), c.y + t * c.h],
        [c.x + c.w - 5 - (k % 3), c.y + t * c.h],
        [c.x + t * c.w, c.y + 5 + (k % 3)],
        [c.x + t * c.w, c.y + c.h - 6 - (k % 3)],
      ])
        if (k % 4 === 0) set(x!, y!, [70, 220, 90]);
    }
    // a gold star at the bottom and a green sign at the top
    for (let y = -7; y <= 7; y++)
      for (let x = -7; x <= 7; x++) if (Math.abs(x) + Math.abs(y) < 9) set(c.x + c.w / 2 + x, c.y + c.h - 14 + y, [250, 200, 60]);
    for (let y = 0; y < 18; y++) for (let x = 0; x < 34; x++) set(c.x + c.w / 2 + 6 + x, c.y - 4 + y, [40, 140, 70]);
    expect(read(img, c)).toBe('refined_spear');
  }, 60000);
});
