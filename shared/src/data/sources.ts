/* "How to get" an item: shop odds by rarity + concrete sources found in encounter, perk and item texts.
 * Shop odds, Forged and Cursed rules: oakentower.wiki.gg (Shop, Rarity, Lucky Shops; CC BY-SA 4.0).
 */
import type { ItemDef } from '../core/types';
import { ENCOUNTERS } from './encounters';
import { ITEMS } from './items';
import { PERKS } from './perks';

/** shop odds in % per level: [common, rare, epic, legendary] (wiki "Shop"; maxed at level 7) */
export const SHOP_ODDS: Record<number, [number, number, number, number]> = {
  1: [75, 25, 0, 0],
  2: [65, 30, 5, 0],
  3: [54, 35, 10, 1],
  4: [50, 30, 15, 5],
  5: [40, 30, 20, 10],
  6: [30, 30, 25, 15],
  7: [20, 30, 30, 20],
};
const SHOP_RARITY = ['Common', 'Rare', 'Epic', 'Legendary'];

export interface Source {
  kind: 'shop' | 'encounter' | 'perk' | 'item' | 'forge' | 'lucky' | 'event';
  text: string;
  /** day it can happen first, if known */
  day?: number;
}

const LUCKY = 'Lucky Shop (more luck; Carmen on day 9, Bishop on day 11, Rainbow Potion)';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text: string, name: string) => new RegExp('\\b' + esc(name) + '(?:e?s)?\\b', 'i').test(text);

/** first level at which a shop rarity can appear, and its best odds */
export function shopInfo(rarity: string): { fromLevel: number; best: number; bestLevel: number } | null {
  const k = SHOP_RARITY.indexOf(rarity);
  if (k < 0) return null;
  const levels = Object.keys(SHOP_ODDS).map(Number);
  const from = levels.find((l) => SHOP_ODDS[l]![k]! > 0) ?? 1;
  const best = Math.max(...levels.map((l) => SHOP_ODDS[l]![k]!));
  return { fromLevel: from, best, bestLevel: levels.find((l) => SHOP_ODDS[l]![k] === best)! };
}

let cache: Record<string, Source[]> | null = null;

function build(): Record<string, Source[]> {
  const out: Record<string, Source[]> = {};
  const add = (id: string, s: Source) => (out[id] ||= []).some((x) => x.text === s.text) || out[id]!.push(s);

  for (const it of ITEMS) {
    const shop = shopInfo(it.rarity);
    if (shop)
      add(it.id, {
        kind: 'shop',
        text:
          `Shop, ${it.cost}g – ${it.rarity} items appear from level ${shop.fromLevel}, most often at level ${shop.bestLevel}` +
          (shop.bestLevel === 7 ? '+' : '') +
          ` (${shop.best}% of shop slots)`,
      });
    if (it.rarity === 'Forged') {
      add(it.id, {
        kind: 'forge',
        text: 'Anvil: 20 iron stacks (from your swords) give a random Forge Blade; Anvil 3★ gives one on every trigger',
      });
      add(it.id, { kind: 'lucky', text: LUCKY + ' with a Forged Blade' });
    }
    if (it.rarity === 'Cursed') {
      add(it.id, { kind: 'encounter', text: 'Count Vlado (day 9): “Cursed Artifact”', day: 9 });
      add(it.id, { kind: 'lucky', text: LUCKY + ' with a cursed item' });
    }
  }
  // encounter rewards that name an item
  for (const e of ENCOUNTERS)
    for (const [opt, text] of e.o)
      for (const it of ITEMS)
        if (mentions(text, it.name))
          add(it.id, {
            kind: 'encounter',
            text: `${e.name}${e.day ? ' (day ' + e.day + ')' : ''}: “${opt}” – ${text}`,
            day: e.day ?? undefined,
          });
  // perk starting items
  for (const p of PERKS) {
    const start = p.sim?.start;
    const it = start ? ITEMS.find((i) => i.name === start) : undefined;
    if (it) add(it.id, { kind: 'perk', text: `Perk ${p.name}: start with it`, day: 1 });
  }
  // items that create other items ("Gain a Dread", "random card", "Forge Blade")
  for (const src of ITEMS) {
    const txt = src.ab.filter(Boolean).join(' ');
    if (!txt) continue;
    for (const it of ITEMS) {
      if (it === src) continue;
      if (new RegExp('gain (?:a|an|\\d+|2|3|4) ' + esc(it.name) + 's?\\b', 'i').test(txt))
        add(it.id, { kind: 'item', text: `Made by ${src.name}` });
    }
    if (/random cards?/i.test(txt))
      ITEMS.filter((i) => i.tag === 'Card').forEach((c) => add(c.id, { kind: 'item', text: `Made by ${src.name} (random card)` }));
  }
  for (const it of ITEMS)
    if (it.rarity === 'Special' && !(out[it.id] || []).some((s) => s.kind !== 'shop'))
      add(it.id, { kind: 'event', text: 'Special item: comes from events or other items (exact source not documented on the wiki yet)' });
  return out;
}

export function howToGet(it: Pick<ItemDef, 'id'>): Source[] {
  if (!cache) cache = build();
  return cache[it.id] || [];
}

/** one short line for cards and guides */
export function howToGetShort(it: ItemDef): string {
  const s = howToGet(it);
  const special = s.find((x) => x.kind !== 'shop');
  if (it.rarity === 'Forged') return 'Anvil or Lucky Shop';
  if (it.rarity === 'Cursed') return 'Count Vlado (day 9) or Lucky Shop';
  if (special && special.kind === 'perk') return special.text;
  const shop = shopInfo(it.rarity);
  if (shop) return `Shop ${it.cost}g · from level ${shop.fromLevel}` + (special ? ' · also: ' + special.text.split(':')[0] : '');
  return special ? special.text.split(' – ')[0]! : 'Unknown source';
}
