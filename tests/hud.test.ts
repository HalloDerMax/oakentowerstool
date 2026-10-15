import path from 'node:path';
import { createWorker, OEM, PSM } from 'tesseract.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERKS } from '../shared/src/data/perks';
import { slug } from '../shared/src/data/slug';
import {
  autoLayout,
  benchWindows,
  gameArea,
  HUD_FIELDS,
  inkOnPaper,
  parseHud,
  PERK_BOX,
  placeOnScreen,
  readable,
  REF_H,
  REF_W,
  type HudKey,
  type InkMode,
} from '../renderer/hud';
import { crop, identify, makeTemplate, resize, type Img } from '../renderer/recognize';
import { ITEMS } from '../shared/src/data/items';
import { encodePng, readPng } from './png';

/* Two real game screens (1915×1079 and 1919×1079), rebuilt from cut-outs without the player name. */
function screen(prefix: string, w: number): Img {
  const out = { w, h: REF_H, data: new Uint8ClampedArray(w * REF_H * 4) };
  const paste = (file: string, x: number, y: number) => {
    const p = readPng('tests/fixtures/screens/' + file);
    for (let r = 0; r < p.h; r++) out.data.set(p.data.subarray(r * p.w * 4, (r + 1) * p.w * 4), ((y + r) * w + x) * 4);
  };
  paste(prefix + '-top.png', 700, 0);
  paste(prefix + '-bottom.png', 620, 850);
  paste(prefix + '-hp.png', 60, 960);
  paste(prefix + '-perk.png', 0, 230);
  return out;
}

describe('reading the HUD', () => {
  let ocr: Awaited<ReturnType<typeof createWorker>>;
  beforeAll(async () => {
    ocr = await createWorker('eng', OEM.LSTM_ONLY, {
      langPath: path.resolve('node_modules/@tesseract.js-data/eng/4.0.0_best_int'),
      gzip: true,
      cacheMethod: 'none',
    });
  }, 60000);
  afterAll(() => ocr?.terminate());

  async function read(img: Img) {
    // no calibration: the game fills the display
    const at = placeOnScreen({});
    const text: Partial<Record<HudKey, string>> = {};
    for (const f of HUD_FIELDS) {
      const r = at(f.box);
      const part = crop(img, r.x * img.w, r.y * img.h, r.w * img.w, r.h * img.h);
      const big = resize(part, part.w * 3, part.h * 3);
      await ocr.setParameters({ tessedit_char_whitelist: f.chars, tessedit_pageseg_mode: PSM.SINGLE_LINE });
      const once = async (ink: InkMode) =>
        (await ocr.recognize(encodePng({ w: big.w, h: big.h, data: inkOnPaper(big, ink) }))).data.text.trim();
      let t = await once(f.ink);
      if (f.alt && !readable(f.key, t)) t = await once(f.alt);
      text[f.key] = t;
    }
    return parseHud(text);
  }

  it('day 1, casual', async () => {
    expect(await read(screen('hud', REF_W))).toEqual({
      day: 1,
      trophies: [0, 10],
      lives: [10, 10],
      odds: [75, 25, 0, 0],
      gold: 35,
      income: 45,
      level: 1,
      xp: [0, 52],
      luck: 0,
      chest: 'Rare',
      hp: [500, 500],
    });
  }, 120000);

  it('day 6, epic chest next', async () => {
    expect(await read(screen('hud2', 1919))).toEqual({
      day: 6,
      trophies: [4, 10],
      lives: [9, 10],
      odds: [54, 35, 10, 1],
      gold: 79,
      income: 65,
      level: 3,
      xp: [12, 60],
      luck: 1,
      chest: 'Epic',
      hp: [1399, 1399],
    });
  }, 120000);

  it('knows the perk from its picture', () => {
    const perks = PERKS.map((p) => makeTemplate(p.id, readPng('shared/public/img/' + slug(p.name) + '.png')));
    const at = placeOnScreen({});
    for (const [prefix, w, perk] of [
      ['hud', REF_W, 'toxic'],
      ['hud2', 1919, 'midas_regards'],
    ] as const) {
      const img = screen(prefix, w);
      const r = at(PERK_BOX);
      expect(identify(crop(img, r.x * img.w, r.y * img.h, r.w * img.w, r.h * img.h), perks)?.id).toBe(perk);
    }
  });

  it('finds the item on the bench', () => {
    const items = ITEMS.map((it) => makeTemplate(it.id, readPng('shared/public/img/' + slug(it.name) + '.png')));
    const bench = readPng('tests/fixtures/screens/bench2.png');
    const img = { w: 1919, h: REF_H, data: new Uint8ClampedArray(1919 * REF_H * 4) };
    for (let r = 0; r < bench.h; r++)
      img.data.set(bench.data.subarray(r * bench.w * 4, (r + 1) * bench.w * 4), ((860 + r) * 1919 + 830) * 4);
    const at = placeOnScreen({});
    const seen = benchWindows()
      .map(at)
      .map((r) => identify(crop(img, r.x * img.w, r.y * img.h, r.w * img.w, r.h * img.h), items, undefined, 'mirrored')?.id)
      .filter(Boolean);
    expect([...new Set(seen)]).toEqual(['bomb_wagon']);
  }, 60000);
});

describe('no calibration needed in fullscreen', () => {
  it('uses the known layout on a 16:9 display', () => {
    const l = autoLayout({ width: 1920, height: 1080 });
    expect(l.shop).toHaveLength(2);
    expect(l.shop[0]!.n).toBe(4);
    expect(l.shop[1]!.n).toBe(3);
    expect(l.tower.x * 1920).toBeCloseTo(135 * (1920 / REF_W), 0);
  });
  it('centres the 16:9 game on an ultrawide display (black bars left and right)', () => {
    const g = gameArea({ width: 3440, height: 1440 });
    expect(g.w).toBeCloseTo(2560 / 3440, 3);
    expect(g.x).toBeCloseTo(440 / 3440, 3);
    expect(g.y).toBe(0);
  });
});
