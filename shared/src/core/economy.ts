/* Roll or level? Expected gold to find the items you want, from the wiki's shop rules:
 *   reroll 3 gold; from the 16th reroll of a day each one costs 2 more (2·max(0, n−14) + 3)
 *   level-up costs 4·level + 48 XP; XP costs 1 gold (bought in batches of 4); +12 XP per won day, +8 per lost day
 *   income 5·level + 40 per day; shop odds by level (maxed at level 7); 7 items per shop
 * Source: oakentower.wiki.gg (Shop, Level, XP). Everything here is plain arithmetic, no simulation.
 */
import { ITEMS } from '../data/items';
import { SHOP_ODDS } from '../data/sources';

export const SHOP_RARITIES = ['Common', 'Rare', 'Epic', 'Legendary'] as const;
export type ShopRarity = (typeof SHOP_RARITIES)[number];
const SHOP_SIZE = 7;
const POOL: Record<ShopRarity, number> = Object.fromEntries(
  SHOP_RARITIES.map((r) => [r, ITEMS.filter((i) => i.rarity === r).length || 1]),
) as Record<ShopRarity, number>;

/** price of the n-th reroll of the day (n counts from 0) */
export const rerollCost = (n: number): number => 2 * Math.max(0, n - 14) + 3;
/** XP (= gold, if bought) to go from `level` to `level + 1` */
export const levelCost = (level: number): number => 4 * level + 48;
export const income = (level: number): number => 5 * level + 40;
const odds = (level: number, r: ShopRarity) => (SHOP_ODDS[Math.max(1, Math.min(7, level))]![SHOP_RARITIES.indexOf(r)] ?? 0) / 100;

/** chance that one shop shows at least one of `targets` specific items of rarity r */
export function hitChance(level: number, r: ShopRarity, targets = 1, poolSize = POOL[r]): number {
  const perSlot = (odds(level, r) * Math.min(targets, poolSize)) / poolSize;
  return 1 - Math.pow(1 - perSlot, SHOP_SIZE);
}

/** expected gold spent on rerolls until a hit. Prices start at 3g again every day, so a long search is
 *  spread over days at 3g a roll; only rolls past the 15th of today (done ≥ 15) cost more. */
export function expectedRollGold(p: number, done = 0): number {
  if (p <= 0) return Infinity;
  if (p >= 1) return rerollCost(done);
  // today's remaining cheap rolls, then 3g per roll on later days
  const cheapLeft = Math.max(0, 15 - done);
  if (!cheapLeft) return rerollCost(done) + ((1 - p) * 3) / p;
  return 3 / p;
}

export interface EconomyInput {
  level: number;
  /** XP still missing to the next level (default: the full level cost) */
  xpToNext?: number;
  gold: number;
  /** rerolls already made today */
  rerollsToday?: number;
  /** what you are looking for */
  rarity: ShopRarity;
  /** how many different items of that rarity would do (e.g. 3 good Epics for your build) */
  targets?: number;
  /** days the extra income of a level still pays out */
  daysLeft?: number;
}
export interface EconomyAdvice {
  action: 'roll' | 'level' | 'save';
  /** expected gold to find a target by rolling now */
  rollNow: number;
  /** level up first (XP bought), then roll */
  levelFirst: number;
  /** extra income the level brings back over daysLeft */
  incomeBack: number;
  xpGold: number;
  /** chance per shop now / after the level */
  pNow: number;
  pNext: number;
  /** rerolls you can afford today at the current level before levelling becomes the better deal (null = never) */
  rollBudget: number | null;
  reason: string;
}

export function advise(i: EconomyInput): EconomyAdvice {
  const targets = i.targets ?? 1;
  const done = i.rerollsToday ?? 0;
  const xpGold = Math.ceil((i.xpToNext ?? levelCost(i.level)) / 4) * 4;
  const pNow = hitChance(i.level, i.rarity, targets);
  const pNext = hitChance(i.level + 1, i.rarity, targets);
  const rollNow = expectedRollGold(pNow, done);
  const incomeBack = 5 * Math.max(0, i.daysLeft ?? 0);
  const levelFirst = xpGold + expectedRollGold(pNext, done) - incomeBack;
  const levelBetter = levelFirst < rollNow;
  // how many rolls at this level are worth it before switching to "level first"
  let rollBudget: number | null = null;
  if (levelBetter) rollBudget = 0;
  else if (Number.isFinite(levelFirst)) {
    for (let n = 0; n < 60; n++) {
      // after n+1 misses, is levelling now cheaper than continuing?
      if (xpGold + expectedRollGold(pNext, done + n + 1) - incomeBack < expectedRollGold(pNow, done + n + 1)) {
        rollBudget = n + 1;
        break;
      }
    }
  }
  let action: EconomyAdvice['action'];
  let reason: string;
  const R = i.rarity;
  if (pNow === 0 && pNext === 0) {
    action = 'level';
    reason = R + ' items are not in the shop at level ' + i.level + ' or ' + (i.level + 1) + ' yet. Save gold and level up first.';
  } else if (pNext < pNow) {
    action = i.gold >= rerollCost(done) ? 'roll' : 'save';
    reason = R + ' items get rarer when you level (' + pct(pNow) + ' → ' + pct(pNext) + ' per shop). Roll for them before you level.';
  } else if (levelBetter) {
    action = i.gold >= xpGold ? 'level' : 'save';
    reason =
      'Levelling first is cheaper: ' +
      xpGold +
      'g of XP makes a hit ' +
      (pNow ? (pNext / pNow).toFixed(1) + '× as likely' : 'possible') +
      ' (' +
      pct(pNow) +
      ' → ' +
      pct(pNext) +
      ' per shop)' +
      (incomeBack ? ', and the level pays back ' + incomeBack + 'g in income' : '') +
      '.';
  } else {
    action = i.gold >= rerollCost(done) ? 'roll' : 'save';
    reason =
      'Rolling now is cheaper (about ' +
      gold(rollNow) +
      ' vs ' +
      gold(levelFirst) +
      ' with a level first)' +
      (rollBudget ? '. If ' + rollBudget + ' rolls bring nothing, level up before rolling more.' : '.');
  }
  return { action, rollNow, levelFirst, incomeBack, xpGold, pNow, pNext, rollBudget, reason };
}

/** expected gold to hit one target at each level, for a quick table */
export function oddsTable(r: ShopRarity, targets = 1): { level: number; perShop: number; gold: number }[] {
  return [1, 2, 3, 4, 5, 6, 7].map((level) => {
    const p = hitChance(level, r, targets);
    return { level, perShop: p, gold: expectedRollGold(p) };
  });
}

const pct = (p: number) => Math.round(p * 1000) / 10 + '%';
const gold = (g: number) => (Number.isFinite(g) ? Math.round(g) + 'g' : '∞');
