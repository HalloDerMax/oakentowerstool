/* Oaken Tower Fan Hub – potions usable in the simulator (item-targeted combat potions)
 * Source: oakentower.wiki.gg/wiki/Potions (CC BY-SA 4.0). Potions are consumed on use; their bonuses are flat and permanent
 * (not multiplied by the item's stars). In the builder each potion can go on ONE item or on the WHOLE DECK (every item in the tower).
 * P(name, tier, cost, effect, label)  effect keys: dmg crit heal block burn poison bleed shock mc charges | cd (+/- seconds) | cdSet | shockDmg (global) | tag
 * Not simulated (no combat effect): gold, XP, luck, reroll, max-HP, morph/copy potions, Gold Plating, Value Potion...
 */
import type { PotionDef, PotionFx, PotionTier } from '../core/types';
import { slug } from './slug';

const L: PotionDef[] = [];
const P = (name: string, tier: PotionTier, cost: number, fx: PotionFx, text: string) =>
  L.push({ id: slug(name), name, tier, cost, fx, text });

/* Lesser */
P('Lesser Crit Potion', 'Lesser', 8, { crit: 3 }, '+3% crit');
P('Lesser Damage Potion', 'Lesser', 8, { dmg: 1 }, '+1 damage');
P('Lesser Heal Potion', 'Lesser', 8, { heal: 1 }, '+1 heal');
P('Lesser Shield Potion', 'Lesser', 8, { block: 1 }, '+1 shield');
/* Vials */
P('Burn Vial', 'Vial', 15, { burn: 1 }, '+1 burn');
P('Crit Vial', 'Vial', 10, { crit: 8 }, '+8% crit');
P('Damage Vial', 'Vial', 8, { dmg: 3 }, '+3 damage');
P('Heal Vial', 'Vial', 12, { heal: 3 }, '+3 heal');
P('Poison Vial', 'Vial', 15, { poison: 1 }, '+1 poison');
P('Shield Vial', 'Vial', 12, { block: 3 }, '+3 shield');
P('Shock Vial', 'Vial', 10, { shock: 1 }, '+1 shock');
P('Time Vial', 'Vial', 10, { cd: -0.2 }, '-0.2s cooldown');
/* Regular */
P('Blood Flask', 'Regular', 30, { bleed: 1 }, '+1 bleed');
P('Fire Bottle', 'Regular', 25, { burn: 2 }, '+2 burn');
P('Flask of Venom', 'Regular', 25, { poison: 2 }, '+2 poison');
P('Iron Potion', 'Regular', 18, { block: 8 }, '+8 shield');
P('Mending Serum', 'Regular', 18, { heal: 8 }, '+8 heal');
P('Precision Flask', 'Regular', 15, { crit: 25 }, '+25% crit');
P('Sharpness Oil', 'Regular', 12, { dmg: 4, crit: 15 }, '+4 damage, +15% crit');
P('Shock Potion', 'Regular', 12, { shock: 3 }, '+3 shock');
P('Thunder Potion', 'Regular', 12, { shockDmg: 20 }, '+20 shock damage (whole fight)');
P('Time Tonic', 'Regular', 18, { cd: -0.5 }, '-0.5s cooldown');
P('Wrath Potion', 'Regular', 15, { dmg: 8 }, '+8 damage');
P('Ink', 'Regular', 5, { cdSet: 100 }, 'cooldown set to 100s (shuts an item off)');
/* Major */
P('Jar of Charges', 'Major', 35, { charges: 1 }, '+1 max charge (items with charges)');
P('Jungleblood', 'Major', 45, { poison: 8 }, '+8 poison');
P('Phantom Brew', 'Major', 60, { mc: 1 }, '+1 multicast');
/* Essences: add a tag, so type-based synergies count the item */
[
  ['Arcane', 'arcane'],
  ['Crystal', 'crystal'],
  ['Dark', 'dark'],
  ['Dragon', 'dragon'],
  ['Elf', 'elven'],
  ['Flame', 'flame'],
  ['Frost', 'frosty'],
  ['Goblin', 'goblin'],
  ['Holy', 'holy'],
  ['Moon', 'moon'],
  ['Storm', 'storm'],
  ['Witch', 'witch'],
].forEach((e) => P(e[0] + ' Essence', 'Essence', 15, { tag: e[1] }, 'adds the ' + e[0] + ' tag'));

export const POTIONS = L;
export const POTION_BY_ID: Record<string, PotionDef> = Object.fromEntries(L.map((p) => [p.id, p]));
export const POTION_TIERS: PotionTier[] = ['Lesser', 'Vial', 'Regular', 'Major', 'Essence'];
