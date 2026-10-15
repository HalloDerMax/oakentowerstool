/* Grows calculated builds phase by phase. Used by scripts/gen-builds.ts for the Builds page and by the simulation
 * worker for builds made for the player's own pack selection.
 *   Days 1–4 / 5–8: add items until the tower is full; days 9–12 / 13–16: replace at most two items.
 * A candidate's value = simulated gain × chance to see it in the shop in that phase. Stars come from combining copies.
 * Deterministic (fixed seeds).
 */
import { perkSlots, simulateMany } from './engine';
import { evaluate, freeSlots, suggest } from './optimize';
import type { Build, ItemDef } from './types';
import type { Archetype } from '../data/archetypes';
import { ITEMS } from '../data/items';
import { PERKS } from '../data/perks';
import {
  starFromCopies,
  BUILD_DIRECTIONS,
  PHASES,
  SHOPS_PER_DAY,
  SHOP_SIZE,
  SPECIAL_SOURCE_CHANCE,
  levelOnDay,
  type Phase,
} from '../data/progression';
import { SHOP_ODDS } from '../data/sources';

const SHOP_RARITY = ['Common', 'Rare', 'Epic', 'Legendary'];
const SWAP_MIN_GAIN = 0.01; // score units; smaller swaps are not worth the gold
/** builds are scored against a much tougher enemy than the phase test enemy, so "more damage" keeps counting */
const SCORE_HP_MULT = 10;
/** at least this many items from the build's own packs (if the pool has them) */
const MIN_OWN = 4;
/** gold limits how many copies you can buy: max star per phase (no gold model yet) */
const STAR_CAP: Record<Phase['id'], number> = { p1: 1, p2: 2, p3: 3, p4: 3 };
/** builds kept per perk */
export const MIN_PER_PERK = 3;

/* ---------- perks: what the simulator knows about them ---------- */
/** shop-side effects we model (the fight itself does not change) */
export const SHOP_PERKS: Record<string, Partial<Econ>> = {
  stock: { shopSize: SHOP_SIZE + 1 }, // 8 items instead of 7
  gathering: { earlyShops: 1 }, // 3 free rerolls ≈ one more shop on days 1–3
  reflection: { reflection: true }, // a plain copy of the first item you buy
};
export interface Econ {
  shopSize: number;
  earlyShops: number;
  reflection: boolean;
}
export const ECON0: Econ = { shopSize: SHOP_SIZE, earlyShops: 0, reflection: false };
let econ: Econ = ECON0;
export type Model = 'combat' | 'shop' | 'none';
export const modelOf = (id: string): Model => (PERKS.find((p) => p.id === id)?.sim ? 'combat' : SHOP_PERKS[id] ? 'shop' : 'none');

/* ---------- shop statistics ---------- */
function makePool(def: Archetype): ItemDef[] {
  return ITEMS.filter((i) => {
    if (i.rarity === 'Special') return false;
    if (def.tags?.length && !def.tags.includes(i.tag)) return false;
    if (def.type && i.type !== def.type) return false;
    const inPack = def.packs.includes(i.pack) || (!!i.pack2 && def.packs.includes(i.pack2));
    return inPack || i.pack === 'Neutral';
  });
}

/** the items that give the build its identity: its packs, or its tag/type filter for pack-less builds */
function ownPool(def: Archetype): ItemDef[] {
  return makePool(def).filter((i) => (def.packs.length ? def.packs.includes(i.pack) || (!!i.pack2 && def.packs.includes(i.pack2)) : true));
}

/** chance that one shop slot shows this exact item on a day */
function slotChance(it: ItemDef, day: number, pool: ItemDef[]): number {
  const k = SHOP_RARITY.indexOf(it.rarity);
  if (k < 0) return 0;
  const odds = SHOP_ODDS[Math.min(levelOnDay(day), 7)]![k]! / 100;
  const same = pool.filter((x) => x.rarity === it.rarity).length || 1;
  return odds / same;
}
/** expected number of times the item shows up between two days (inclusive) */
function expectedSeen(it: ItemDef, from: number, to: number, pool: ItemDef[]): number {
  let e = 0;
  for (let d = from; d <= to; d++) e += (SHOPS_PER_DAY + (d <= 3 ? econ.earlyShops : 0)) * econ.shopSize * slotChance(it, d, pool);
  return e;
}
/** chance to see the item at least once during a phase */
function seenInPhase(it: ItemDef, ph: Phase, pool: ItemDef[]): number {
  if (it.rarity === 'Forged' || it.rarity === 'Cursed') return ph.days[0] >= 9 ? SPECIAL_SOURCE_CHANCE : 0;
  return 1 - Math.exp(-expectedSeen(it, ph.days[0], ph.days[1], pool));
}
/** star an item has reached by `day` when bought on `bought` (extra copies only for shop items) */
function starBy(it: ItemDef, bought: number, day: number, pool: ItemDef[], extra = 0): number {
  if (!SHOP_RARITY.includes(it.rarity)) return 0;
  return starFromCopies(1 + extra + expectedSeen(it, bought + 1, day, pool));
}

/* ---------- building ---------- */
interface Owned {
  id: string;
  bought: number;
  /** free copies (Reflection) */
  extra?: number;
}
interface Step {
  phase: Phase['id'];
  day: number;
  k: 'start' | 'buy' | 'swap' | 'slot';
  itemId: string;
  cell: number;
  replaced?: string;
  slot?: string;
  /** chance to see the item in this phase */
  seen?: number;
  winRate: number;
  avgTime: number;
}

const BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

function toBuild(cells: (Owned | null)[], slotAt: (string | null)[], perks: string[], ph: Phase, pool: ItemDef[]): Build {
  const day = ph.days[1];
  return {
    name: '',
    rows: 3,
    cols: 2,
    cells: cells.map((c) => (c ? { id: c.id, star: Math.min(STAR_CAP[ph.id], starBy(BY_ID[c.id]!, c.bought, day, pool, c.extra)) } : null)),
    slotAt: [...slotAt],
    perks,
    potions: [],
    day,
    level: levelOnDay(day),
    enemy: { ...ph.enemy },
  };
}

export function grow(def: Archetype, perks: string[]) {
  const pool = makePool(def);
  const cells: (Owned | null)[] = new Array(6).fill(null);
  const slotAt: (string | null)[] = new Array(6).fill(null);
  const steps: Step[] = [];
  const phases: {
    id: Phase['id'];
    winRate: number;
    avgTime: number;
    level: number;
    enemyHp: number;
    items: { id: string; star: number }[];
    build: Pick<Build, 'cells' | 'slotAt' | 'perks' | 'day' | 'level'>;
  }[] = [];

  // perk starting items (day 1)
  let n = 0;
  for (const p of perks) {
    const start = PERKS.find((x) => x.id === p)?.sim?.start;
    const it = start && ITEMS.find((i) => i.name === start);
    if (it && !cells.some((c) => c?.id === it.id)) cells[n++] = { id: it.id, bought: 1 };
  }
  /** score vs a tough enemy (optimizing); report vs the phase test enemy (what the guide shows) */
  const ev = (ph: Phase, seeds = 4) => {
    const b = toBuild(cells, slotAt, perks, ph, pool);
    return evaluate({ ...b, enemy: { ...b.enemy, hp: b.enemy.hp * SCORE_HP_MULT } }, { seeds });
  };
  const report = (ph: Phase) => evaluate(toBuild(cells, slotAt, perks, ph, pool), { seeds: 4 });
  const own = new Set(ownPool(def).map((i) => i.id));
  const ownCount = () => cells.filter((c) => c && own.has(c.id)).length;
  cells.forEach((c, i) => c && steps.push({ phase: 'p1', day: 1, k: 'start', itemId: c.id, cell: i, ...pick(report(PHASES[0]!)) }));
  /** own-pack items still needed to keep the build's identity */
  const ownNeeded = (ph: Phase) => {
    const available = [...own].filter((id) => seenInPhase(BY_ID[id]!, ph, pool) > 0.05 && !cells.some((c) => c?.id === id));
    return ownCount() < MIN_OWN && available.length > 0;
  };

  for (const ph of PHASES) {
    const span = ph.days[1] - ph.days[0] + 1;
    let actions = 0;
    const dayFor = () => ph.days[0] + Math.min(span - 1, Math.floor((actions * span) / Math.max(1, (ph.fill ?? 6) - 2)));
    const owned = () => new Set(cells.filter(Boolean).map((c) => c!.id));

    if (ph.mode === 'add') {
      while (cells.filter(Boolean).length < (ph.fill ?? 6)) {
        const base = ev(ph, 2).score;
        const empty = cells.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
        const mustOwn = ownNeeded(ph);
        const cands = pool.filter((it) => !owned().has(it.id) && seenInPhase(it, ph, pool) > 0.05 && (!mustOwn || own.has(it.id)));
        // screening in the first empty cell, value = gain × chance to see it
        const scored = cands
          .map((it) => {
            cells[empty[0]!] = { id: it.id, bought: ph.days[0] };
            const g = ev(ph, 2).score - base;
            cells[empty[0]!] = null;
            return { it, v: Math.max(0, g) * seenInPhase(it, ph, pool), g };
          })
          .sort((a, b) => b.v - a.v)
          .slice(0, 8);
        let best: { it: ItemDef; cell: number; v: number } | null = null;
        for (const { it } of scored)
          for (const cell of empty) {
            cells[cell] = { id: it.id, bought: dayFor() };
            const g = ev(ph).score - base;
            cells[cell] = null;
            const v = Math.max(0, g) * seenInPhase(it, ph, pool);
            if (!best || v > best.v) best = { it, cell, v };
          }
        if (!best) break;
        // if nothing adds damage any more, the first (most likely) candidate still completes the tower
        const day = dayFor();
        const firstBuy = econ.reflection && !steps.some((x) => x.k === 'buy');
        cells[best.cell] = { id: best.it.id, bought: day, ...(firstBuy ? { extra: 1 } : {}) };
        steps.push({
          phase: ph.id,
          day,
          k: 'buy',
          itemId: best.it.id,
          cell: best.cell,
          seen: +seenInPhase(best.it, ph, pool).toFixed(2),
          ...pick(report(ph)),
        });
        actions++;
      }
    } else {
      for (let s = 0; s < (ph.swaps ?? 0); s++) {
        const base = ev(ph).score;
        let best: { it: ItemDef; cell: number; v: number; g: number } | null = null;
        const startIds = new Set(steps.filter((x) => x.k === 'start').map((x) => x.itemId));
        for (let cell = 0; cell < 6; cell++) {
          const cur = cells[cell];
          if (!cur || startIds.has(cur.id)) continue;
          for (const it of pool) {
            if (owned().has(it.id)) continue;
            // never trade an own-pack item for a Neutral one if that breaks the build's identity
            if (own.has(cur.id) && !own.has(it.id) && ownCount() <= MIN_OWN) continue;
            const pSeen = seenInPhase(it, ph, pool);
            if (pSeen < 0.05) continue;
            cells[cell] = { id: it.id, bought: ph.days[0] + 1 };
            const g = ev(ph, 2).score - base;
            cells[cell] = cur;
            const v = g * pSeen;
            if (g > SWAP_MIN_GAIN && (!best || v > best.v)) best = { it, cell, v, g };
          }
        }
        if (!best) break;
        // confirm with full seeds
        const cur = cells[best.cell]!;
        const day = ph.days[0] + Math.min(span - 1, s * 2);
        cells[best.cell] = { id: best.it.id, bought: day };
        if (ev(ph).score - base <= SWAP_MIN_GAIN) {
          cells[best.cell] = cur;
          break;
        }
        // a slot belongs to the tower cell, so it now boosts the new item
        steps.push({
          phase: ph.id,
          day,
          k: 'swap',
          itemId: best.it.id,
          cell: best.cell,
          replaced: cur.id,
          seen: +seenInPhase(best.it, ph, pool).toFixed(2),
          ...pick(report(ph)),
        });
      }
    }

    // perk slots unlocked by the end of this phase go where they help most (vs a 4× tougher enemy)
    for (;;) {
      const b = toBuild(cells, slotAt, perks, ph, pool);
      if (!Object.values(freeSlots(b)).some((v) => v > 0)) break;
      const tough: Build = { ...b, enemy: { ...b.enemy, hp: b.enemy.hp * 4 } };
      const s = suggest(tough, { top: 100 }).find((x) => x.kind === 'slot');
      if (!s) break;
      slotAt[s.cell] = s.slot!;
      // the slot is placed once it is unlocked AND the item is in the tower
      const unlock = perkSlots(perks).find((x) => x.slot === s.slot)?.day ?? ph.days[0];
      const slotDay = Math.min(ph.days[1], Math.max(ph.days[0], unlock, cells[s.cell]!.bought));
      steps.push({ phase: ph.id, day: slotDay, k: 'slot', itemId: cells[s.cell]!.id, cell: s.cell, slot: s.slot, ...pick(report(ph)) });
    }

    const end = toBuild(cells, slotAt, perks, ph, pool);
    const e = report(ph);
    phases.push({
      id: ph.id,
      winRate: e.winRate,
      avgTime: +e.avgTime.toFixed(1),
      level: end.level,
      enemyHp: ph.enemy.hp,
      items: end.cells.map((c) => (c ? { id: c.id, star: c.star } : null)).filter(Boolean) as { id: string; star: number }[],
      build: { cells: end.cells, slotAt: [...slotAt], perks: perks, day: end.day, level: end.level },
    });
  }
  const final = toBuild(cells, slotAt, perks, PHASES[PHASES.length - 1]!, pool);
  return { final, steps, phases };
}
const pick = (e: { winRate: number; avgTime: number }) => ({ winRate: e.winRate, avgTime: +e.avgTime.toFixed(1) });

/** highest enemy HP beaten in >= 50 % of fights (log-scale binary search) */
export function power(b: Build): number {
  const beats = (hp: number) => evaluate({ ...b, enemy: { ...b.enemy, hp } }, { seeds: 4 }).winRate >= 0.5;
  let lo = 100,
    hi = 100;
  if (!beats(lo)) return 0;
  while (beats(hi) && hi < 1e9) {
    lo = hi;
    hi *= 4;
  }
  for (let k = 0; k < 14; k++) {
    const mid = Math.sqrt(lo * hi);
    if (beats(mid)) lo = mid;
    else hi = mid;
  }
  return Math.round(lo);
}

export type Grown = ReturnType<typeof grow> & { def: Archetype; perks: string[]; power: number };
/** the main pack (or type/tag) of a direction: the builds for one perk should not all be the same pack */
export const lane = (d: Archetype) => d.packs[0] ?? d.type ?? d.tags?.[0] ?? d.id;

/** the direction that plays the perk's own mechanic: always one of its builds, even when another pack simulates stronger */
export const HOME: Record<string, string> = {
  toxic: 'poison',
  scorch: 'burn',
  electric: 'shock',
  strike: 'multicast',
  darkness: 'dark',
  hex: 'hex',
  chosen: 'holy',
  turtle: 'shield',
  melee: 'melee',
  artillery: 'artillery',
  archmage: 'fairy',
  growth: 'witch',
  power: 'crit',
};

export function bestFor(
  perks: string[],
  e: Econ,
  directions: Archetype[] = BUILD_DIRECTIONS,
  onStep?: (done: number, total: number) => void,
): Grown[] {
  econ = e;
  const all = directions
    .map((def, i) => {
      const g = grow(def, perks);
      onStep?.(i + 1, directions.length);
      return { ...g, def, perks, power: power(g.final) };
    })
    .sort((x, y) => y.power - x.power);
  const out: Grown[] = [];
  for (const g of all) {
    if (out.length >= MIN_PER_PERK) break;
    if (out.some((o) => lane(o.def) === lane(g.def))) continue;
    out.push(g);
  }
  const home = HOME[perks[0] ?? ''];
  if (home && !out.some((o) => o.def.id === home)) {
    const h = all.find((g) => g.def.id === home);
    if (h) out[out.length - 1] = h;
    out.sort((x, y) => y.power - x.power);
  }
  econ = ECON0;
  return out;
}

const perkName = (id: string) => PERKS.find((p) => p.id === id)?.name ?? id;

/** the finished build object for the Builds page (damage sources, early power) */
export function finishBuild(key: string, x: Grown, forPerks: string[], model: Model) {
  const ref = simulateMany(x.final, {}, 20);
  const dmg = Object.entries(ref.avgBySource).sort((a, b) => b[1] - a[1]);
  const totalDmg = dmg.reduce((s, v) => s + v[1], 0) || 1;
  const p2 = x.phases.find((p) => p.id === 'p2')!;
  econ = { ...ECON0, ...(SHOP_PERKS[key] ?? {}) };
  const early = power({ ...x.final, ...p2.build, enemy: x.final.enemy, name: '', rows: 3, cols: 2, potions: [] });
  econ = ECON0;
  return {
    id: key + '-' + x.def.id,
    name: x.def.name + ' · ' + (x.perks.length ? perkName(x.perks[0]!) : 'Free perk'),
    mechanic: x.def.mechanic,
    blurb: x.def.blurb,
    packs: x.def.packs,
    perks: x.perks,
    forPerks,
    model,
    build: { cells: x.final.cells, slotAt: x.final.slotAt, perks: x.final.perks, day: x.final.day, level: x.final.level },
    power: x.power,
    early,
    sources: dmg.slice(0, 3).map(([k, v]) => ({ name: k, share: +(v / totalDmg).toFixed(3) })),
    steps: x.steps,
    phases: x.phases,
  };
}
export type FinishedBuild = ReturnType<typeof finishBuild>;

/* ---------- builds for the player's own pack selection (Builds page, runs in the worker) ---------- */
/** directions that only use the chosen packs (pack-less ones always fit), plus one that mixes all chosen packs */
export function directionsFor(packs: string[], perk: string | null, max = 6): Archetype[] {
  const set = new Set(packs);
  const fits = BUILD_DIRECTIONS.filter((d) => d.packs.every((p) => set.has(p)));
  const home = perk ? HOME[perk] : undefined;
  // the perk's own direction first, then two-pack hybrids (more of your packs), then the rest
  fits.sort((a, b) => Number(b.id === home) - Number(a.id === home) || b.packs.length - a.packs.length);
  const mine: Archetype = {
    id: 'mine',
    name: 'Your packs',
    mechanic: 'Mixed',
    blurb: 'The strongest mix of the packs you play.',
    perks: [],
    packs: [...set],
  };
  return [...fits.slice(0, max - 1), mine];
}

/** grow builds for a pack selection and one perk (null = any perk without a combat effect); best first */
export function buildsForPacks(packs: string[], perk: string | null, onStep?: (done: number, total: number) => void): FinishedBuild[] {
  const model: Model = perk ? modelOf(perk) : 'none';
  const perks = perk && model !== 'none' ? [perk] : [];
  const dirs = directionsFor(packs, perk);
  const grown = bestFor(perks, { ...ECON0, ...(perk ? (SHOP_PERKS[perk] ?? {}) : {}) }, dirs, onStep);
  return grown.map((g) => {
    const b = finishBuild('mine-' + (perk ?? 'free'), g, perk ? [perk] : [], model);
    // the perk shows on the build even when the simulator does not model it
    return { ...b, perks: perk ? [perk] : [], build: { ...b.build, perks: perk ? [perk] : [] } };
  });
}
