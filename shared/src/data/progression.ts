/* Game phases for the calculated builds (Builds tab) and their guides.
 * Levels follow a typical run (level 4 / 7 / 10 around day 5 / 10 / 16). Enemy values are fan estimates.
 */
import type { Archetype } from './archetypes';
import { ARCHETYPES } from './archetypes';

export interface Phase {
  id: 'p1' | 'p2' | 'p3' | 'p4';
  name: string;
  days: [number, number];
  levels: [number, number];
  /** star level items are expected to reach in this phase */
  star: number;
  /** add items until this many cells are filled ("add"), or replace up to `swaps` items ("swap") */
  mode: 'add' | 'swap';
  fill?: number;
  swaps?: number;
  /** test enemy for this phase */
  enemy: { hp: number; shield: number; dps: number };
}

export const PHASES: Phase[] = [
  { id: 'p1', name: 'Days 1–4', days: [1, 4], levels: [1, 3], star: 0, mode: 'add', fill: 4, enemy: { hp: 1500, shield: 0, dps: 20 } },
  { id: 'p2', name: 'Days 5–8', days: [5, 8], levels: [4, 6], star: 1, mode: 'add', fill: 6, enemy: { hp: 6000, shield: 50, dps: 60 } },
  {
    id: 'p3',
    name: 'Days 9–12',
    days: [9, 12],
    levels: [7, 8],
    star: 2,
    mode: 'swap',
    swaps: 2,
    enemy: { hp: 30000, shield: 300, dps: 180 },
  },
  {
    id: 'p4',
    name: 'Days 13–16',
    days: [13, 16],
    levels: [9, 10],
    star: 3,
    mode: 'swap',
    swaps: 2,
    enemy: { hp: 100000, shield: 1000, dps: 400 },
  },
];

/** typical player level on day d (index = day) */
export const LEVEL_ON_DAY = [0, 1, 2, 3, 3, 4, 5, 5, 6, 7, 7, 8, 8, 9, 9, 10, 10];
export const levelOnDay = (d: number): number => LEVEL_ON_DAY[Math.max(1, Math.min(d, LEVEL_ON_DAY.length - 1))]!;

/** shops seen per day (the daily shop + a couple of rerolls) – assumption */
export const SHOPS_PER_DAY = 3;
export const SHOP_SIZE = 7;
/** chance to find a Forged blade / cursed item in a phase where they exist (Lucky Shop, Anvil, Count Vlado) – assumption */
export const SPECIAL_SOURCE_CHANCE = 0.25;
/** Stars come from combining two copies of the same star (player guides: "combine your Silver Lance to 2 star"),
 *  which matches the ×2 value per star: 1★ = 2 copies, 2★ = 4, 3★ = 8. */
export const copiesForStar = (star: number): number => 2 ** star;
/** star reached with this many copies in total */
export const starFromCopies = (copies: number): number => Math.max(0, Math.min(3, Math.floor(Math.log2(Math.max(1, copies)))));

/** Calculated builds: every archetype plus hybrids that mix two packs */
export const HYBRIDS: Archetype[] = [
  {
    id: 'burn-crit',
    name: 'Firebrand',
    mechanic: 'Burn · Crit',
    blurb: 'Burn stacks plus Dragon crit damage.',
    perks: ['scorch', 'power'],
    packs: ['Flame', 'Dragon'],
  },
  {
    id: 'bleed-dark',
    name: 'Night Cutter',
    mechanic: 'Bleed · Start of Combat',
    blurb: 'Crystal bleed with Dark start-of-combat bursts.',
    perks: ['darkness', 'power'],
    packs: ['Crystal', 'Dark'],
  },
  {
    id: 'poison-holy',
    name: 'Plague Doctor',
    mechanic: 'Poison · Heal',
    blurb: 'Unblockable poison while Holy healing keeps you alive.',
    perks: ['toxic', 'chosen'],
    packs: ['Elven', 'Holy'],
  },
  {
    id: 'shock-moon',
    name: 'Moonstorm',
    mechanic: 'Shock · Multicast',
    blurb: 'Shock stacks from multicast Moon items.',
    perks: ['electric', 'strike'],
    packs: ['Storm', 'Moon'],
  },
  {
    id: 'hex-frost',
    name: 'Frostbite Hex',
    mechanic: 'Debuffs · Crit',
    blurb: 'Random debuffs and Frosty crits.',
    perks: ['hex', 'power'],
    packs: ['Arcane', 'Frosty'],
  },
  {
    id: 'vampire-crit',
    name: 'Blood Moon',
    mechanic: 'Lifesteal · Crit',
    blurb: 'Sanguine crits lifesteal more often.',
    perks: ['power'],
    packs: ['Vampire', 'Dragon'],
  },
  {
    id: 'fairy-arcane',
    name: 'Spellweaver',
    mechanic: 'Spell chains · Debuffs',
    blurb: 'Spells that trigger each other and spread debuffs.',
    perks: ['archmage', 'hex'],
    packs: ['Fairy', 'Arcane'],
  },
  {
    id: 'bombs-burn',
    name: 'Powder Keg',
    mechanic: 'Bombs · Burn',
    blurb: 'Goblin bombs backed by burning damage.',
    perks: ['scorch', 'power'],
    packs: ['Goblin', 'Flame'],
  },
];

export const OUR_BUILD_DEFS: Archetype[] = [...ARCHETYPES, ...HYBRIDS];

/** Directions the Builds generator tries for every perk (the archetype's own perks are ignored there: one perk per run) */
export const BUILD_DIRECTIONS: Archetype[] = [
  ...OUR_BUILD_DEFS,
  { id: 'wind', name: 'Tailwind', mechanic: 'Speed', blurb: 'Wind items that speed the tower up.', perks: [], packs: ['Wind'] },
];
