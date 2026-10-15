/* Reading the game's HUD: day, trophies, lives, gold, income, level, XP, luck, next chest, shop odds, HP and the perk.
 *
 * Positions are known from the game's layout at 1915×1079 (REF). The calibrated shop rows and tower tell where the
 * game sits on screen and how big it is, so the same places are found at any window size. Without a calibration
 * the game is assumed to fill the display.
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
}
export const HUD_FIELDS: HudField[] = [
  { key: 'day', box: [785, 15, 70, 58], chars: '0123456789', ink: 'light' },
  { key: 'trophies', box: [925, 15, 110, 58], chars: '0123456789/', ink: 'light' },
  { key: 'lives', box: [1105, 15, 125, 58], chars: '0123456789/', ink: 'light' },
  { key: 'odds', box: [1272, 15, 225, 38], chars: '0123456789% ', ink: 'bright' },
  { key: 'gold', box: [712, 866, 110, 50], chars: '0123456789', ink: 'light' },
  { key: 'income', box: [660, 912, 140, 32], chars: 'Income:0123456789 ', ink: 'light' },
  { key: 'level', box: [688, 950, 100, 30], chars: 'Level:0123456789 ', ink: 'light' },
  { key: 'xp', box: [660, 977, 160, 42], chars: '0123456789/', ink: 'light' },
  { key: 'luck', box: [676, 1022, 120, 28], chars: 'Luck:0123456789% ', ink: 'light' },
  { key: 'chest', box: [668, 1046, 150, 28], chars: 'Chest:CommonRareEpicLegendary ', ink: 'bright' },
  { key: 'hp', box: [80, 975, 470, 55], chars: '0123456789/', ink: 'white' },
];
/** the perk picture left of the tower */
export const PERK_BOX: [number, number, number, number] = [6, 243, 56, 56];

/** reference pixels → fractions of the display, using the calibration when there is one */
export function placeOnScreen(cfg: DesktopConfig): (b: [number, number, number, number]) => Rect {
  const t = cfg.tower,
    r = cfg.shop?.[0];
  let sx = 1 / REF_W,
    sy = 1 / REF_H,
    ox = 0,
    oy = 0;
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
  const chest = /(Common|Rare|Epic|Legendary)/.exec(text.chest ?? '');
  if (chest) h.chest = chest[1];
  const hp = pair(text.hp ?? '');
  if (hp && hp[0] <= hp[1]) h.hp = hp;
  return h;
}
