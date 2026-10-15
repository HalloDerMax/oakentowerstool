/* Which encounter choices help a build? Simple, explainable rules on the build's items, packs, tags and mechanics.
 * Used by the build guides. Encounter texts: src/data/encounters.ts (wiki).
 */
import type { Cell } from '../core/types';
import { ENCOUNTERS } from './encounters';
import { ITEM_BY_ID } from './items';

export interface EncounterPick {
  encounter: string;
  day: number | null;
  option: string;
  text: string;
  why: string;
  /** higher = more important for this build */
  weight: number;
}

const WEAPON_TAGS = new Set(['Axe', 'Mace', 'Sword', 'Bow', 'Dagger', 'Spear']);

interface Ctx {
  ids: string[];
  tags: Set<string>;
  packs: Set<string>;
  mech: string;
  rarities: Set<string>;
  weapons: number;
}
type Rule = { enc: string; option: string; when: (c: Ctx) => string | null; weight: number };

const has = (c: Ctx, word: string) => c.mech.includes(word.toLowerCase());
const RULES: Rule[] = [
  { enc: 'Blacksmith', option: 'Upgrade!', weight: 3, when: (c) => (has(c, 'crit') ? '+30% crit chance on your main weapon' : null) },
  { enc: "Drakk'Zar", option: 'Sharp Claws', weight: 4, when: (c) => (has(c, 'crit') ? '+80% crit chance on your best crit item' : null) },
  { enc: 'Warrior', option: 'Sharpen', weight: 3, when: (c) => (c.weapons >= 3 ? '+6 damage on all ' + c.weapons + ' weapons' : null) },
  {
    enc: 'Blacksmith',
    option: 'Heavy Armor',
    weight: 2,
    when: (c) => (c.tags.has('Shield') || has(c, 'shield') ? 'start every fight with a shield' : null),
  },
  {
    enc: 'Shieldbearer',
    option: 'Shield Mastery',
    weight: 3,
    when: (c) => (c.tags.has('Shield') ? '+1 multicast and +10 shield on a shield' : null),
  },
  {
    enc: 'Elven Archer',
    option: 'Elven Favor',
    weight: 3,
    when: (c) => (c.tags.has('Bow') || has(c, 'ranged') ? 'an Artillery slot for your bows' : null),
  },
  {
    enc: 'Elven Archer',
    option: 'Take my Bow',
    weight: 2,
    when: (c) => (c.packs.has('Elven') || has(c, 'multicast') ? 'a bow with +4 multicast' : null),
  },
  {
    enc: 'Katya',
    option: 'Take My Spear',
    weight: 3,
    when: (c) => (c.ids.includes('refined_spear') || c.tags.has('Spear') ? 'a Refined Spear with +10 damage' : null),
  },
  {
    enc: 'Sage',
    option: 'Holy Favor',
    weight: 3,
    when: (c) => (c.packs.has('Holy') || has(c, 'heal') ? 'two healing spells with +1 multicast' : null),
  },
  {
    enc: 'Sage',
    option: 'Sacred Touch',
    weight: 1,
    when: (c) => (has(c, 'heal') || has(c, 'lifesteal') ? 'a Vitality slot for more max HP' : null),
  },
  {
    enc: 'Lyra',
    option: 'Northern Blessing',
    weight: 3,
    when: (c) => (c.packs.has('Frosty') ? 'a Frozen Orb and one more Frosty item' : null),
  },
  {
    enc: 'Count Vlado',
    option: 'Gain His Amulet',
    weight: 4,
    when: (c) => (c.ids.includes('nightquill') ? 'a 3★ Nightquill for your tower' : null),
  },
  {
    enc: 'Count Vlado',
    option: 'Cursed Artifact',
    weight: 2,
    when: (c) => (c.rarities.has('Cursed') ? 'the way to get your cursed item' : null),
  },
  {
    enc: 'Carmen',
    option: 'Lucky Rerolls',
    weight: 3,
    when: (c) => (c.rarities.has('Forged') || c.rarities.has('Legendary') ? 'more luck for Legendary items and Forged blades' : null),
  },
  {
    enc: 'Carmen',
    option: 'Walk on Water',
    weight: 2,
    when: (c) => (has(c, 'multicast') || has(c, 'trigger') || has(c, 'shock') ? '−0.3s cooldown on every item' : null),
  },
  {
    enc: 'Enchanter',
    option: 'Enchant',
    weight: 2,
    when: (c) => (c.rarities.has('Common') || c.rarities.has('Rare') ? 'a free 2★ on a common or rare key item' : null),
  },
  { enc: 'Celestia', option: 'Wish', weight: 3, when: () => 'turns a 2★ key item into 3★ (copies are expensive late)' },
  { enc: 'Master Alderos', option: 'Ascendence', weight: 2, when: (c) => (c.rarities.has('Epic') ? 'upgrades an epic key item' : null) },
  {
    enc: 'Bishop',
    option: 'Exaltation',
    weight: 2,
    when: (c) => (c.weapons >= 2 || has(c, 'multicast') ? '+15 damage on every item, it adds up with many hits' : null),
  },
  {
    enc: 'Bishop',
    option: 'Benediction',
    weight: 2,
    when: (c) => (c.rarities.has('Forged') ? 'lucky rerolls for your Forged blade' : null),
  },
  {
    enc: 'Chronomancer',
    option: 'Request Artifact',
    weight: 1,
    when: (c) => (c.packs.has('Witch') || has(c, 'potion') ? 'Time Pendant for potion scaling' : null),
  },
];

/** the encounter choices that help this build, by day */
export function encountersFor(b: { cells: (Cell | null)[]; packs: string[]; mechanic: string }, max = 6): EncounterPick[] {
  const items = b.cells
    .filter(Boolean)
    .map((c) => ITEM_BY_ID[c!.id]!)
    .filter(Boolean);
  const ctx: Ctx = {
    ids: items.map((i) => i.id),
    tags: new Set(items.map((i) => i.tag)),
    packs: new Set([...b.packs, ...items.flatMap((i) => [i.pack, i.pack2 ?? ''])].filter(Boolean)),
    mech: (b.mechanic + ' ' + items.flatMap((i) => i.ab).join(' ')).toLowerCase(),
    rarities: new Set(items.map((i) => i.rarity)),
    weapons: items.filter((i) => WEAPON_TAGS.has(i.tag)).length,
  };
  const out: EncounterPick[] = [];
  for (const r of RULES) {
    const why = r.when(ctx);
    if (!why) continue;
    const e = ENCOUNTERS.find((x) => x.name === r.enc);
    const opt = e?.o.find((o) => o[0] === r.option);
    if (!e || !opt) continue;
    // one choice per encounter: keep the more important one
    const same = out.findIndex((x) => x.encounter === e.name);
    if (same >= 0) {
      if (out[same]!.weight >= r.weight) continue;
      out.splice(same, 1);
    }
    out.push({ encounter: e.name, day: e.day ?? null, option: opt[0], text: opt[1], why, weight: r.weight });
  }
  return out
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max)
    .sort((a, b) => (a.day ?? 99) - (b.day ?? 99));
}
