/* Build archetypes for the calculated builds (scripts/gen-builds.ts, see also progression.ts for hybrids).
 * Each archetype = perks + the packs it draws items from (Neutral is always allowed) + optional fixed core items.
 * Edit freely; run `npm run gen-builds` afterwards.
 */
export interface Archetype {
  id: string;
  name: string;
  /** one-line idea of the build */
  blurb: string;
  /** the mechanic the build is about, shown as a label (Poison, Bleed, Lifesteal …) */
  mechanic: string;
  perks: string[];
  packs: string[];
  /** items that are placed first (besides the perk start item) */
  core?: string[];
  /** only items with one of these tags (e.g. Shield) – for archetypes without a pack */
  tags?: string[];
  /** only melee (M) or ranged (R) items */
  type?: 'M' | 'R';
}

export const ARCHETYPES: Archetype[] = [
  {
    id: 'burn',
    name: 'Scorched Earth',
    mechanic: 'Burn',
    blurb: 'Stack burn fast and let it tick.',
    perks: ['scorch', 'power'],
    packs: ['Flame'],
  },
  {
    id: 'poison',
    name: 'Venom Garden',
    mechanic: 'Poison',
    blurb: 'Unblockable poison that never decays.',
    perks: ['toxic', 'power'],
    packs: ['Elven'],
  },
  {
    id: 'shock',
    name: 'Stormcaller',
    mechanic: 'Shock',
    blurb: 'Shock stacks and raised shock damage.',
    perks: ['electric', 'power'],
    packs: ['Storm'],
  },
  {
    id: 'bleed',
    name: 'Crystal Cuts',
    mechanic: 'Bleed',
    blurb: 'Bleed that adds to every hit.',
    perks: ['power', 'turtle'],
    packs: ['Crystal'],
  },
  {
    id: 'vampire',
    name: 'Bloodline',
    mechanic: 'Lifesteal',
    blurb: 'Lifesteal heals you and triggers Hand of Blood and Crimson Amulet.',
    perks: ['power'],
    packs: ['Vampire'],
  },
  { id: 'crit', name: "Dragon's Eye", mechanic: 'Crit', blurb: 'Crit chance turned into damage.', perks: ['power'], packs: ['Dragon'] },
  {
    id: 'multicast',
    name: 'Moonlit Strikes',
    mechanic: 'Multicast',
    blurb: 'Multicast and Moon scaling.',
    perks: ['strike', 'power'],
    packs: ['Moon'],
  },
  {
    id: 'dark',
    name: 'Nightfall',
    mechanic: 'Start of Combat',
    blurb: 'Start-of-combat bursts, doubled at night.',
    perks: ['darkness', 'power'],
    packs: ['Dark'],
  },
  {
    id: 'hex',
    name: 'Hexweaver',
    mechanic: 'Debuffs',
    blurb: 'Random debuffs that scale per unique debuff.',
    perks: ['hex', 'power'],
    packs: ['Arcane'],
  },
  {
    id: 'melee',
    name: 'Brawler',
    mechanic: 'Melee',
    blurb: 'Neutral melee weapons with the Melee slot.',
    perks: ['melee', 'power'],
    packs: [],
    type: 'M',
  },
  {
    id: 'artillery',
    name: 'Long Bow',
    mechanic: 'Ranged',
    blurb: 'Ranged items with the Artillery slot.',
    perks: ['artillery', 'power'],
    packs: [],
    type: 'R',
  },
  {
    id: 'frost',
    name: 'Deep Freeze',
    mechanic: 'Crit · Retrigger',
    blurb: 'Frosty crits and retriggers.',
    perks: ['power'],
    packs: ['Frosty'],
  },
  {
    id: 'bombs',
    name: 'Goblin Workshop',
    mechanic: 'Bombs',
    blurb: 'Charge-limited bombs and Goblin buffers.',
    perks: ['power'],
    packs: ['Goblin'],
  },
  { id: 'holy', name: 'Holy Light', mechanic: 'Heal', blurb: 'Healing turned into damage.', perks: ['chosen', 'power'], packs: ['Holy'] },
  {
    id: 'shield',
    name: 'Bulwark',
    mechanic: 'Shield',
    blurb: 'Shields first, damage from shield effects.',
    perks: ['turtle', 'power'],
    packs: [],
    tags: ['Shield'],
  },
  {
    id: 'fairy',
    name: 'Fairy Tale',
    mechanic: 'Spell chains',
    blurb: 'Spell chains that trigger each other.',
    perks: ['archmage', 'power'],
    packs: ['Fairy'],
  },
  {
    id: 'witch',
    name: 'Cauldron',
    mechanic: 'Potions',
    blurb: 'Potion-fuelled scaling (potions only partly simulated).',
    perks: ['growth', 'power'],
    packs: ['Witch'],
  },
];

export const TIERS = [
  { id: 'S', name: 'Top', min: 0.66 },
  { id: 'A', name: 'Strong', min: 0.33 },
  { id: 'B', name: 'Solid', min: 0.166 },
  { id: 'C', name: 'Situational', min: 0.083 },
  { id: 'D', name: 'Niche', min: 0.04 },
  { id: 'F', name: 'Weak', min: 0 },
] as const;
export type TierId = (typeof TIERS)[number]['id'];
