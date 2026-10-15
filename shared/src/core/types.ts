/* Shared types for data, parser, engine and store. Pure – no DOM. */

export type Rarity = 'Common' | 'Rare' | 'Epic' | 'Legendary' | 'Forged' | 'Special' | 'Cursed';
export type Debuff = 'burn' | 'poison' | 'bleed' | 'shock';

/** Numeric item stats. Base values are the 0★ values. */
export interface ItemStats {
  crit?: number;
  mc?: number;
  poison?: number;
  burn?: number;
  bleed?: number;
  shock?: number;
  block?: number;
  heal?: number;
  charges?: number;
  /** 1 = this item lifesteals on hit (wiki "LifeSteal = true") */
  lifesteal?: number;
}

export interface ItemDef {
  /** slug(name) – part of the save format, never rename */
  id: string;
  name: string;
  rarity: Rarity;
  pack: string;
  pack2: string | null;
  tag: string;
  cost: number;
  type: 'M' | 'R';
  dmg: number;
  cd: number;
  st: ItemStats;
  /** ability text per star; null = no ability, shorter array = later stars inherit the last text */
  ab: (string | null)[];
}

export interface PerkSim {
  start?: string;
  slots?: { slot: string; day: number }[];
  shockDmg?: { day: number; n: number };
  healCrit?: boolean;
  shieldCrit?: boolean;
}

export interface PerkDef {
  id: string;
  name: string;
  effect: string;
  unlock: string;
  mdNote?: string;
  sim?: PerkSim;
}

export type SlotStat = 'bleed' | 'burn' | 'crit' | 'dmg' | 'heal' | 'mc' | 'poison' | 'block' | 'shock';

export interface SlotDef {
  id: string;
  name: string;
  desc: string;
  stat?: SlotStat;
  base?: number;
  step?: number;
  every?: number;
  sim: boolean;
}

export interface Encounter {
  name: string;
  day: number | null;
  o: [string, string][];
}

export interface PackDef {
  color: string;
  blurb: string;
}

export type PotionTier = 'Lesser' | 'Vial' | 'Regular' | 'Major' | 'Essence';

export interface PotionFx {
  dmg?: number;
  crit?: number;
  heal?: number;
  block?: number;
  burn?: number;
  poison?: number;
  bleed?: number;
  shock?: number;
  mc?: number;
  charges?: number;
  cd?: number;
  cdSet?: number;
  shockDmg?: number;
  tag?: string;
}

export interface PotionDef {
  id: string;
  name: string;
  tier: PotionTier;
  cost: number;
  fx: PotionFx;
  text: string;
}

export interface Rules {
  starMult: number[];
  critMult: number;
  minCooldown: number;
  burnTick: number;
  poisonTick: number;
  shockTick: number;
  shockBase: number;
  dt: number;
  maxTime: number;
  /** fire that burns both towers late in a fight so it always ends (training fight replay only, values assumed) */
  overtime: { start: number; every: number; pct: number };
  maxTriggersPerSecond: number;
  /** multicast repetitions count toward maxTriggersPerSecond (wiki: each multicast is a trigger) */
  multicastCountsTowardCap: boolean;
  levelHp: number[];
  levelXp: number[];
  rarityOdds: Record<number, number[]>;
  defaultGrid: { rows: number; cols: number };
}

/* ---------- parser output ---------- */

export interface Dir {
  dr: number;
  dc: number;
}

export type Target =
  | { t: 'self' }
  | { t: 'adj'; type: string }
  | { t: 'dir'; dir: Dir; type: string }
  | { t: 'group'; other: boolean; type: string; excludeName?: string };

export interface Cond {
  debuffGE?: number;
  minTag?: [number, string];
  only?: boolean;
  uniqueTypes?: boolean;
  uniqueTag?: string;
}

export type StatMap = Partial<Record<keyof ItemStats | 'dmg', number>>;

export type ActKind =
  | 'trig'
  | 'trigRand'
  | 'poisonTick'
  | 'shockTick'
  | 'triggerSoc'
  | 'gain'
  | 'give'
  | 'gainCtx'
  | 'gainEq'
  | 'maxhp'
  | 'deal'
  | 'dealCrit'
  | 'apply'
  | 'chanceApply'
  | 'cleanse'
  | 'shield'
  | 'destroyShield'
  | 'shockDmg'
  | 'cdAdd'
  | 'cdSet'
  | 'cdSetT'
  | 'cdPct'
  | 'cdCur'
  | 'giveCritDmg'
  | 'transferCrit'
  | 'execute'
  | 'lifesteal';

/** One parsed action. Fields are optional because each kind uses a different subset. */
export interface Act {
  k: ActKind;
  cond?: Cond;
  target?: Target;
  times?: number;
  extra?: boolean;
  inf?: boolean;
  n?: number;
  type?: string;
  stat?: string;
  mult?: number;
  p?: number;
  pct?: number;
  pctMax?: number;
  sec?: number;
  per?: string | null;
  noFloor?: boolean;
  copy?: boolean;
  stats?: StatMap;
  rand?: number;
}

export type EventName =
  | 'soc'
  | 'sod'
  | 'trig'
  | 'critSelf'
  | 'critAny'
  | 'applyDebuff'
  | 'applyBurn'
  | 'bleedOther'
  | 'healOther'
  | 'heal'
  | 'shieldGain'
  | 'poisonTick'
  | 'shockTick'
  | 'trigOther'
  | 'enemyLow'
  | 'potionSelf'
  | 'potionAny'
  | 'lifesteal'
  | 'lifestealOther';

export interface Effect {
  ev: EventName;
  first?: number;
  every?: number;
  pct?: number;
  filter?: { type: string; allowSelf: boolean; side?: 'left' | 'right' };
  acts: Act[];
}

export type Static =
  | { s: 'applyTimes'; stat: string; n: number }
  | { s: 'critMult'; v: number }
  | { s: 'burnFaster'; v: number }
  | { s: 'shockTimes'; v: number }
  | { s: 'socExtra'; v: number }
  | { s: 'lifestealTimes'; n: number }
  | { s: 'lifestealMaxHp'; v: number };

export interface ParsedAbility {
  effects: Effect[];
  statics: Static[];
  unparsed: string[];
  ignored: string[];
  partial?: boolean;
  none: boolean;
}

export type Coverage = 'full' | 'partial' | 'stats' | 'none';

/* ---------- build / simulation ---------- */

export interface Cell {
  id: string;
  star: number;
}

export type PotionTarget = 'deck' | number;

export interface PotionUse {
  id: string;
  t: PotionTarget;
  n: number;
}

/** One tower: what both your build and an opponent have. */
export interface TowerState {
  cells: (Cell | null)[];
  slotAt: (string | null)[];
  perks: string[];
  potions: PotionUse[];
  level: number;
}

/** The tower you plan against (fights on the same day as yours). */
export interface OpponentState extends TowerState {
  name: string;
}

/** What the store persists (localStorage / share link / export). */
export interface BuildState extends TowerState {
  name: string;
  rows: number;
  cols: number;
  day: number;
  /** opponent tower for versus fights */
  opponent?: OpponentState;
  /** fight the opponent tower instead of the test enemy */
  vs?: boolean;
}

export interface Enemy {
  hp: number;
  shield: number;
  dps: number;
}

export interface Build extends BuildState {
  enemy: Enemy;
}

export interface SimOptions {
  mdClaims?: boolean;
  seed?: number;
  maxTime?: number;
  log?: boolean;
}

export interface TimelinePoint {
  t: number;
  dmg: number;
  enemy: number;
  player: number;
}

export interface ItemReport {
  name: string;
  star: number;
  triggers: number;
  dmg: number;
  crit: number;
  mc: number;
  cd: number;
  burn: number;
  poison: number;
  bleed: number;
  shock: number;
  block: number;
  heal: number;
  coverage: Coverage;
  ability: string | null;
  unparsed: string[];
}

export interface SimResult {
  result: 'win' | 'loss' | 'timeout';
  time: number;
  total: number;
  dps: number;
  enemyLeft: number;
  playerHp: number;
  log: string[];
  timeline: TimelinePoint[];
  bySource: Record<string, number>;
  warnings: string[];
  items: ItemReport[];
}

export interface SimSummary {
  runs: number;
  winRate: number;
  avgTime: number;
  avgDps: number;
  avgTotal: number;
  minTime: number;
  maxTime: number;
}

export interface ManyResult extends SimResult {
  summary: SimSummary;
  avgBySource: Record<string, number>;
}
