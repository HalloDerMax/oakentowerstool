/* Game rules used by the simulator + mechanics glossary.
 * Source: https://oakentower.wiki.gg (CC BY-SA 4.0) + the client's oaken_tower_game_info_resources.md */
import type { Rules } from '../core/types';

export const RULES: Rules = {
  // Confirmed on the wiki: 1* doubles the numbers, 2* = x4, 3* = x8 (Chopper 15/30/60/120, Arcane Mace burn 3/6/12/24).
  starMult: [1, 2, 4, 8],
  critMult: 2, // wiki: crits deal double damage by default
  minCooldown: 1.0, // beginner's guide: cooldown cannot go below 1s (set-effects like "reduce cooldown to 0.5s" bypass this)
  burnTick: 0.5, // burn: X dmg per 0.5s, stacks -1 per tick, blocked by shield
  poisonTick: 1.0, // poison: X dmg per 1s, no decay, ignores shield
  shockTick: 1.0, // shock: 20 base dmg per 1s, 1 stack consumed per tick, blocked by shield
  shockBase: 20,
  dt: 0.05,
  maxTime: 60,
  // Late-fight fire ("fire ticks" that run the HP bars down). Not documented on the wiki or oaken.gg: assumed values –
  // from 20 s, every second, each tick 2 % more of max HP than the last (2 %, 4 %, 6 % …). Only the replay uses it.
  overtime: { start: 20, every: 1, pct: 0.02 },
  maxTriggersPerSecond: 10,
  // Each multicast repetition is a trigger, so it counts toward the 10/s cap. Without this, items with +30 multicast
  // plus never-decaying bleed reach millions of damage in a minute (in-game damage records are ~300k).
  multicastCountsTowardCap: true,
  // Max HP by player level (estimated from the wiki's data table; wiki says the exact formula is unknown).
  levelHp: [0, 500, 900, 1300, 2000, 2900, 4300, 6400, 9700, 13300, 17000, 20000],
  levelXp: [0, 52, 56, 60, 64, 68, 72, 76, 80], // XP cost to reach level N (wiki table)
  rarityOdds: {
    // shop odds per level (wiki table)
    1: [75, 25, 0, 0],
    2: [65, 30, 5, 0],
    3: [54, 35, 10, 1],
    4: [50, 30, 15, 5],
    5: [40, 30, 20, 10],
    6: [30, 30, 25, 15],
    7: [20, 30, 30, 20],
    8: [20, 30, 30, 20],
  },
  defaultGrid: { rows: 3, cols: 2 }, // seen in-game: 3 rows x 2 columns (other layouts offered as an experiment)
};

export const MECHANICS: Record<string, string> = {
  Burn: 'Deals X damage every 0.5s (X = current stacks). Loses 1 stack per tick. Blocked by shields.',
  Poison: 'Deals X damage every 1s (X = stacks). Never decays and ignores shields.',
  Bleed: 'Whenever the enemy is hit by an item they take X extra damage (X = stacks). Never decays. Blocked by shields.',
  Shock:
    'Deals 20 base damage per second and loses 1 stack per tick. Thunder Potion / Stormguard / Morning Star raise the damage, Staff of Zeus speeds it up. Blocked by shields.',
  Multicast: 'An item with +N multicast triggers N additional times each time it fires.',
  Crit: 'A crit deals double damage by default (Frozen Jaw raises this multiplier).',
  Shield: 'Absorbs incoming direct damage. Poison ignores it.',
  Heal: "Restores HP. Some effects also scale from healing (Redemption, Healer's Oath).",
  Lifesteal:
    'Vampire items with Lifesteal heal you when they hit and fire "When you Lifesteal" effects (Hand of Blood, Crimson Amulet). Red Rose turns part of it into max HP. Simulator assumption: a Lifesteal heals for the damage of the hit (the wiki does not give the amount).',
  Triggers: 'Items fire when their cooldown ends. An item can trigger at most 10 times per second and cooldown cannot drop below 1s.',
};
