/* Can you actually get this item soon? Suggestions (advisor, planner) weigh their gain with this chance,
 * so a Forged blade like Harbinger is not offered as a normal buy.
 * Shop: wiki shop odds per level, 3 shops of 7 items per day, items of one rarity share its slots evenly.
 * Forged: only from a Forge Blade (Anvil, 20 iron stacks; 1 of 5 blades) or a Lucky Shop (day 9+).
 * Cursed: Count Vlado (day 9) or a Lucky Shop. Special: made by another item in your tower.
 */
import { ITEMS, ITEM_BY_ID } from '../data/items';
import { SHOP_ODDS, shopInfo } from '../data/sources';

export type ObtainKind = 'shop' | 'forge' | 'lucky' | 'cursed' | 'made' | 'special';
export interface Obtain {
  kind: ObtainKind;
  /** chance to get it within the next ~2 days (0–1) */
  chance: number;
  /** short label for a chip */
  label: string;
  /** one sentence: how */
  how: string;
}
export interface ObtainContext {
  day: number;
  level: number;
  /** item ids already in the tower */
  tower: string[];
}

const SHOPS_PER_DAY = 3;
const SHOP_SIZE = 7;
const DAYS_AHEAD = 2;
const SHOP_RARITY = ['Common', 'Rare', 'Epic', 'Legendary'];
const PER_RARITY = Object.fromEntries(SHOP_RARITY.map((r) => [r, ITEMS.filter((i) => i.rarity === r).length || 1]));
const FORGED = ITEMS.filter((i) => i.rarity === 'Forged').length || 1;
/** rough chance that a Lucky Shop shows one specific Forged / cursed item in the next days */
const LUCKY_CHANCE = 0.06;

export function obtainability(itemId: string, ctx: ObtainContext): Obtain {
  const it = ITEM_BY_ID[itemId];
  if (!it) return { kind: 'special', chance: 0, label: 'unknown', how: 'Unknown item.' };
  const k = SHOP_RARITY.indexOf(it.rarity);
  if (k >= 0) {
    const odds = (SHOP_ODDS[Math.max(1, Math.min(7, ctx.level))]![k] ?? 0) / 100;
    if (!odds) {
      const from = shopInfo(it.rarity)?.fromLevel ?? 1;
      return {
        kind: 'shop',
        chance: 0,
        label: 'shop from Lv ' + from,
        how: it.rarity + ' items are not in the shop before level ' + from + '.',
      };
    }
    const chance = 1 - Math.exp(-(DAYS_AHEAD * SHOPS_PER_DAY * SHOP_SIZE * odds) / PER_RARITY[it.rarity]!);
    return { kind: 'shop', chance, label: 'shop ' + Math.round(chance * 100) + '%', how: 'Shop, ' + it.cost + 'g.' };
  }
  if (it.rarity === 'Forged') {
    if (ctx.tower.includes('anvil'))
      return {
        kind: 'forge',
        chance: 1 / FORGED,
        label: 'Anvil 1 in ' + FORGED,
        how: 'Forge Blade from your Anvil (20 iron stacks from swords): 1 in ' + FORGED + ' blades is this one.',
      };
    if (ctx.day >= 9)
      return {
        kind: 'lucky',
        chance: LUCKY_CHANCE,
        label: 'Lucky Shop',
        how: 'Only from a Lucky Shop (Carmen day 9, Bishop day 11) or an Anvil.',
      };
    return {
      kind: 'forge',
      chance: 0,
      label: 'forge only',
      how: 'Forge only: needs an Anvil (20 iron stacks from swords) or a Lucky Shop from day 9.',
    };
  }
  if (it.rarity === 'Cursed')
    return ctx.day >= 9
      ? { kind: 'cursed', chance: 0.3, label: 'Count Vlado', how: 'Count Vlado (day 9, “Cursed Artifact”) or a Lucky Shop.' }
      : { kind: 'cursed', chance: 0, label: 'from day 9', how: 'Cursed items come from Count Vlado on day 9 or a Lucky Shop.' };
  // Special: made by another item
  const maker = ITEMS.find(
    (src) =>
      ctx.tower.includes(src.id) &&
      new RegExp('gain (?:a|an|\\d+) ' + it.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(src.ab.join(' ')),
  );
  if (maker) return { kind: 'made', chance: 1, label: 'from ' + maker.name, how: 'Made by your ' + maker.name + '.' };
  return { kind: 'special', chance: 0.02, label: 'special', how: 'Special item: made by other items or events.' };
}

/** value of a suggestion once you weigh in how likely you get it (star upgrades need more copies of the same item) */
export function weighted(gain: number, o: Obtain, copiesNeeded = 1): number {
  const c = Math.min(1, o.chance);
  return gain * (copiesNeeded <= 1 ? c : Math.pow(c, Math.min(3, copiesNeeded) / 2));
}
