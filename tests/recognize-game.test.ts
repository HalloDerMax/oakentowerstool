import { describe, expect, it } from 'vitest';
import { ITEMS } from '../shared/src/data/items';
import { slug } from '../shared/src/data/slug';
import { cells, crop, identify, makeTemplate, type Facing, type ItemTemplate } from '../renderer/recognize';
import { readPng } from './png';

/* Cut-outs of a real game screen (v0.6.5, 1915×1079): a shop with two offset rows and the tower.
 * The boxes are what the calibration would store: one box per shop row, one for the tower grid. */
describe('item recognition on a real game screenshot', () => {
  const items: ItemTemplate[] = ITEMS.map((it) => makeTemplate(it.id, readPng('shared/public/img/' + slug(it.name) + '.png')));
  const read = (img: ReturnType<typeof readPng>, box: [number, number, number, number], cols: number, rows: number, f: Facing) =>
    cells(crop(img, ...box), cols, rows).map((s) => identify(s, items, undefined, f)?.id ?? null);

  it('reads both shop rows (4 places on top, one sold; 3 below)', () => {
    const shop = readPng('tests/fixtures/screens/shop.png');
    expect(read(shop, [15, 25, 760, 140], 4, 1, 'normal')).toEqual(['dragonbone', 'ruby_knife', null, 'flare']);
    expect(read(shop, [57, 300, 675, 140], 3, 1, 'normal')).toEqual(['flare', 'flare', 'paladin_s_hammer']);
  }, 120000);

  it('reads the tower, where the game draws items mirrored', () => {
    const tower = readPng('tests/fixtures/screens/tower.png');
    expect(read(tower, [15, 20, 365, 560], 2, 3, 'mirrored')).toEqual(['refined_spear', 'wildfire', null, null, null, null]);
  }, 120000);
});
