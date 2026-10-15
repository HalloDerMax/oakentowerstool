/* Reading the game's HUD: day, trophies, lives, gold, income, level, XP, luck, next chest, shop odds, HP and the perk.
 *
 * Positions are known from the game's layout at 1915×1079 (REF). The calibrated shop rows and tower tell where the
 * game sits on screen and how big it is, so the same places are found at any window size. Without a calibration
 * the game is assumed to fill the display (fullscreen / borderless, 16:9 centred): see autoLayout.
 */
import type { DesktopConfig, Rect } from './bridge';

export const REF_W = 1915;
export const REF_H = 1079;
/** the boxes a calibration of the reference screen gives (left edge of the tower, right edge of shop row 1 …) */
const REF_TOWER = { x: 135, y: 250, w: 365, h: 560 };
const REF_ROW1 = { x: 795, y: 225, w: 760, h: 140 };

export type HudKey = 'day' | 'trophies' | 'lives' | 'odds' | 'gold' | 'income' | 'level' | 'xp' | 'luck' | 'chest' | 'hp';
/** how to separate the text from the background: light text, pure white text, or any bright / coloured text */
export type InkMode = 'light' | 'white' | 'bright';
export interface HudField {
  key: HudKey;
  box: [number, number, number, number];
  chars: string;
  ink: InkMode;
  /** tried when the first reading makes no sense (coloured text differs from game to game) */
  alt?: InkMode;
}
export const HUD_FIELDS: HudField[] = [
  { key: 'day', box: [785, 15, 70, 58], chars: '0123456789', ink: 'light' },
  { key: 'trophies', box: [925, 15, 110, 58], chars: '0123456789/', ink: 'light' },
  { key: 'lives', box: [1105, 15, 125, 58], chars: '0123456789/', ink: 'light' },
  { key: 'odds', box: [1272, 15, 225, 38], chars: '0123456789% ', ink: 'light', alt: 'bright' },
  { key: 'gold', box: [712, 866, 110, 50], chars: '0123456789', ink: 'light' },
  { key: 'income', box: [660, 912, 140, 32], chars: 'Income:0123456789 ', ink: 'light' },
  { key: 'level', box: [688, 950, 100, 30], chars: 'Level:0123456789 ', ink: 'light' },
  { key: 'xp', box: [660, 977, 160, 42], chars: '0123456789/', ink: 'light' },
  { key: 'luck', box: [676, 1022, 120, 28], chars: 'Luck:0123456789% ', ink: 'light' },
  { key: 'chest', box: [664, 1044, 172, 32], chars: 'Chest:CommonRareEpicLegendary ', ink: 'bright' },
  { key: 'hp', box: [80, 975, 470, 55], chars: '0123456789/', ink: 'white' },
];
/** the perk picture left of the tower */
export const PERK_BOX: [number, number, number, number] = [6, 243, 56, 56];

/** reference pixels → fractions of the display, using the calibration when there is one */
/** the game's own layout (from real screens): two offset shop rows and the 2×3 tower */
export const REF_SHOP_ROWS: { box: [number, number, number, number]; n: number }[] = [
  { box: [795, 225, 760, 140], n: 4 },
  { box: [837, 500, 675, 140], n: 3 },
];
export const REF_TOWER_BOX: [number, number, number, number] = [135, 250, 365, 560];

/** where the game sits on a display when it runs fullscreen / borderless: a 16:9 picture, centred (black bars on
 * ultrawide or 16:10 screens). Fractions of the display. */
export function gameArea(display?: { width: number; height: number }): Rect {
  const W = display?.width ?? 16,
    H = display?.height ?? 9;
  const gw = Math.min(W, (H * 16) / 9),
    gh = (gw * 9) / 16;
  return { x: (W - gw) / 2 / W, y: (H - gh) / 2 / H, w: gw / W, h: gh / H };
}

/** shop rows and tower without a calibration: the known layout in the game area */
export function autoLayout(display?: { width: number; height: number }): Required<Pick<DesktopConfig, 'shop' | 'tower'>> {
  const at = placeOnScreen({}, display);
  return {
    shop: REF_SHOP_ROWS.map((r) => ({ ...at(r.box), n: r.n })),
    tower: { ...at(REF_TOWER_BOX), cols: 2, rows: 3 },
  };
}

export function placeOnScreen(
  cfg: DesktopConfig,
  display?: { width: number; height: number },
): (b: [number, number, number, number]) => Rect {
  const t = cfg.tower,
    r = cfg.shop?.[0];
  // no calibration: the game fills the display as a centred 16:9 picture
  const g = gameArea(display);
  let sx = g.w / REF_W,
    sy = g.h / REF_H,
    ox = g.x,
    oy = g.y;
  if (t && r) {
    // the widest spans we know: tower left → shop row right, shop row top → tower bottom
    sx = (r.x + r.w - t.x) / (REF_ROW1.x + REF_ROW1.w - REF_TOWER.x);
    sy = (t.y + t.h - r.y) / (REF_TOWER.y + REF_TOWER.h - REF_ROW1.y);
    ox = t.x - REF_TOWER.x * sx;
    oy = r.y - REF_ROW1.y * sy;
  } else if (t) {
    sx = t.w / REF_TOWER.w;
    sy = t.h / REF_TOWER.h;
    ox = t.x - REF_TOWER.x * sx;
    oy = t.y - REF_TOWER.y * sy;
  }
  return ([x, y, w, h]) => ({ x: ox + x * sx, y: oy + y * sy, w: w * sx, h: h * sy });
}

/** text → black on white, bigger (what the text reader likes) */
export function inkOnPaper(img: { w: number; h: number; data: Uint8ClampedArray | Uint8Array }, mode: InkMode): Uint8ClampedArray {
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const r = img.data[i]!,
      g = img.data[i + 1]!,
      b = img.data[i + 2]!;
    const hi = Math.max(r, g, b),
      lo = Math.min(r, g, b);
    const on = mode === 'white' ? lo > 200 : mode === 'bright' ? (hi > 120 && hi - lo > 40) || lo > 150 : hi > 150 && lo > 90;
    const v = on ? 0 : 255;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }
  return out;
}

export interface Hud {
  day?: number;
  trophies?: [number, number];
  lives?: [number, number];
  /** shop odds Common / Rare / Epic / Legendary in % */
  odds?: number[];
  gold?: number;
  income?: number;
  level?: number;
  xp?: [number, number];
  luck?: number;
  chest?: string;
  hp?: [number, number];
}

/** does this text give a sensible value for the field? */
export const readable = (key: HudKey, text: string): boolean => parseHud({ [key]: text })[key] !== undefined;

const pair = (s: string): [number, number] | undefined => {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : undefined;
};
const num = (s: string): number | undefined => {
  const m = /(\d+)/.exec(s);
  return m ? Number(m[1]) : undefined;
};

/** text the reader returned → values, with sanity checks (a misread is dropped, not used) */
export function parseHud(text: Partial<Record<HudKey, string>>): Hud {
  const h: Hud = {};
  const day = num(text.day ?? '');
  if (day && day >= 1 && day <= 99) h.day = day;
  const tr = pair(text.trophies ?? '');
  if (tr && tr[0] <= tr[1] && tr[1] <= 30) h.trophies = tr;
  const li = pair(text.lives ?? '');
  if (li && li[0] <= li[1] && li[1] <= 30) h.lives = li;
  const odds = [...(text.odds ?? '').matchAll(/(\d{1,3})\s*%/g)].map((m) => Number(m[1]));
  if (odds.length === 4 && Math.abs(odds.reduce((a, b) => a + b, 0) - 100) <= 2) h.odds = odds;
  const gold = num(text.gold ?? '');
  if (gold !== undefined && gold < 100000) h.gold = gold;
  const inc = num(text.income ?? '');
  if (inc !== undefined && inc < 10000) h.income = inc;
  const lv = num(text.level ?? '');
  if (lv && lv <= 50) h.level = lv;
  const xp = pair(text.xp ?? '');
  if (xp && xp[0] <= xp[1]) h.xp = xp;
  const luck = num(text.luck ?? '');
  if (luck !== undefined && luck <= 100) h.luck = luck;
  // the end of a long word may be cut off: "Legendar" is Legendary
  const chest = /(Common|Rare|Epic|Legend)/.exec(text.chest ?? '');
  if (chest) h.chest = chest[1] === 'Legend' ? 'Legendary' : chest[1];
  const hp = pair(text.hp ?? '');
  if (hp && hp[0] <= hp[1]) h.hp = hp;
  return h;
}

/** the bench under the shop: items there sit anywhere (drawn mirrored, like the tower), so it is searched in overlapping windows */
export const BENCH_BOX: [number, number, number, number] = [840, 872, 1000, 196];
export function benchWindows(): [number, number, number, number][] {
  const [x, y, w, h] = BENCH_BOX;
  const size = 170,
    step = 85;
  const out: [number, number, number, number][] = [];
  for (let at = x; at + size <= x + w + 1; at += step) out.push([at, y, size, h]);
  return out;
}

/** an encounter: two option panels, the option's name on top of each (at 1915×1079) */
export const ENCOUNTER_PANELS: [number, number, number, number][] = [
  [710, 150, 775, 292],
  [710, 480, 775, 292],
];
export const ENCOUNTER_TITLES: [number, number, number, number][] = [
  [712, 152, 600, 58],
  [712, 482, 600, 58],
];

/** a pick screen: choose one of three items (at 1915×1079) */
export const PICK_BOXES: [number, number, number, number][] = [
  [735, 340, 210, 207],
  [1086, 340, 210, 207],
  [1438, 340, 210, 207],
];

/** shop rows and tower from a mapping of reference pixels to the screen */
export function layoutWith(at: (b: [number, number, number, number]) => Rect): Required<Pick<DesktopConfig, 'shop' | 'tower'>> {
  return {
    shop: REF_SHOP_ROWS.map((r) => ({ ...at(r.box), n: r.n })),
    tower: { ...at(REF_TOWER_BOX), cols: 2, rows: 3 },
  };
}
/** the top left tower cell at 1915×1079 (found by its frame), for mapping a snapped tower back to the layout */
export const REF_CELL0 = { x: 138, y: 255, w: 163, h: 159 };
