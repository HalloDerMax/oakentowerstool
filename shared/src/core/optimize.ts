/* Build optimizer: ranks possible next steps for a build by simulated strength against YOUR test enemy.
 * Per fight: win -> 1 + share of the time window left (faster kills score higher); loss/timeout -> share of
 * enemy HP removed. Score = mean over a few fixed seeds, so it is in [0, 2] and deterministic. Pure, no DOM.
 */
import { ITEMS, ITEM_BY_ID } from '../data/items';
import { SLOTS } from '../data/slots';
import { RULES } from '../data/rules';
import { opponentSide, perkSlots, runSeed, simulate, simulateVersus, type VersusResult } from './engine';
import type { Build, BuildState, ItemDef, SimOptions } from './types';

export interface OptimizeOptions {
  /** seeds per evaluation (crits are random) */
  seeds?: number;
  /** star level for newly added items */
  addStar?: number;
  /** restrict new items to these packs (empty = all) */
  packs?: string[];
  /** restrict new items to these rarities (empty = all) */
  rarities?: string[];
  /** restrict new items to these ids (e.g. items from your saved builds); empty = no restriction */
  itemIds?: string[];
  /** suggest items that are already in the tower (default false) */
  duplicates?: boolean;
  /** how many suggestions to return */
  top?: number;
  sim?: SimOptions;
}

export type SuggestionKind = 'add' | 'star' | 'slot';

export interface Evaluation {
  score: number;
  winRate: number;
  /** average fight time (s) */
  avgTime: number;
  /** average share of enemy HP removed (1 = dead) */
  dmgShare: number;
}

export interface Suggestion extends Evaluation {
  kind: SuggestionKind;
  cell: number;
  itemId: string;
  star: number;
  slot?: string;
  /** score difference to the current build */
  gain: number;
}

const clone = <T>(b: T): T => JSON.parse(JSON.stringify(b));

export function evaluate(build: Build, o: OptimizeOptions = {}): Evaluation {
  const seeds = o.seeds ?? 4;
  if (!build.cells.some(Boolean)) return { score: 0, winRate: 0, avgTime: RULES.maxTime, dmgShare: 0 };
  const window = RULES.maxTime;
  const opp = opponentSide(build);
  let score = 0,
    wins = 0,
    time = 0,
    share = 0;
  for (let i = 0; i < seeds; i++) {
    // versus: fight the opponent tower; share of its HP removed counts like damage on the test enemy
    const so = { ...(o.sim || {}), seed: runSeed(i), log: false };
    const r = opp ? simulateVersus(build, opp, so) : simulate(build, so);
    const dealt =
      opp && 'opponent' in r
        ? Math.min(1, 1 - (r as VersusResult).opponent.hpLeft / Math.max(1, (r as VersusResult).opponent.maxHp))
        : Math.min(1, r.total / Math.max(1, build.enemy.hp + build.enemy.shield));
    if (r.result === 'win') {
      wins++;
      score += 1 + Math.max(0, window - r.time) / window;
    } else score += dealt * 0.99; // a loss never beats a win
    time += r.time;
    share += r.result === 'win' ? 1 : dealt;
  }
  return { score: score / seeds, winRate: wins / seeds, avgTime: time / seeds, dmgShare: share / seeds };
}

/** Slots the perks grant on this day that are not used yet: slot id -> free count */
export function freeSlots(s: BuildState): Record<string, number> {
  const out: Record<string, number> = {};
  perkSlots(s.perks).forEach((x) => {
    if (x.day <= s.day) out[x.slot] = (out[x.slot] || 0) + 1;
  });
  s.slotAt.forEach((sl, i) => {
    if (sl && s.cells[i] && out[sl]) out[sl]--;
  });
  return out;
}

function pool(build: BuildState, o: OptimizeOptions): ItemDef[] {
  const inTower = new Set(build.cells.filter(Boolean).map((c) => c!.id));
  return ITEMS.filter(
    (i) =>
      (o.duplicates || !inTower.has(i.id)) &&
      (!o.packs?.length || o.packs.includes(i.pack) || (!!i.pack2 && o.packs.includes(i.pack2))) &&
      (!o.rarities?.length || o.rarities.includes(i.rarity)) &&
      (!o.itemIds?.length || o.itemIds.includes(i.id)),
  );
}

/** Best next steps (add an item, level one up, use a free slot), best first. */
export function suggest(build: Build, o: OptimizeOptions = {}, onProgress?: (done: number, total: number) => void): Suggestion[] {
  const base = evaluate(build, o);
  const addStar = o.addStar ?? 0;
  const empty = build.cells.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  const filled = build.cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  const free = freeSlots(build);
  const freeIds = Object.keys(free).filter((k) => free[k]! > 0 && SLOTS.find((x) => x.id === k)?.sim);
  const cands = pool(build, o);
  const shortlist = Math.min(12, cands.length);
  const total =
    (empty.length ? cands.length + shortlist * Math.max(0, empty.length - 1) : 0) +
    filled.filter((i) => build.cells[i]!.star < 3).length +
    filled.length * freeIds.length;
  let done = 0;
  const tick = () => onProgress?.(++done, Math.max(total, 1));
  const out: Suggestion[] = [];
  const mk = (kind: SuggestionKind, cell: number, itemId: string, star: number, ev: Evaluation, slot?: string): Suggestion => ({
    kind,
    cell,
    itemId,
    star,
    slot,
    ...ev,
    gain: ev.score - base.score,
  });

  if (empty.length) {
    // 1) screening: every candidate in the first empty cell with fewer seeds
    const first = empty[0]!;
    const screened = cands
      .map((it) => {
        const b = clone(build);
        b.cells[first] = { id: it.id, star: addStar };
        const sc = evaluate(b, { ...o, seeds: 2 }).score;
        tick();
        return { it, sc };
      })
      .sort((a, b) => b.sc - a.sc)
      .slice(0, shortlist);
    // 2) best position for each shortlisted item (adjacency matters)
    for (const { it } of screened) {
      let best: Suggestion | null = null;
      for (const cell of empty) {
        const b = clone(build);
        b.cells[cell] = { id: it.id, star: addStar };
        const ev = evaluate(b, o);
        if (cell !== first) tick();
        if (!best || ev.score > best.score) best = mk('add', cell, it.id, addStar, ev);
      }
      out.push(best!);
    }
  }
  // 3) level an item up
  for (const i of filled) {
    const c = build.cells[i]!;
    if (c.star >= 3) continue;
    const b = clone(build);
    b.cells[i] = { id: c.id, star: c.star + 1 };
    out.push(mk('star', i, c.id, c.star + 1, evaluate(b, o)));
    tick();
  }
  // 4) put a free slot under an item
  for (const slot of freeIds)
    for (const i of filled) {
      const b = clone(build);
      b.slotAt[i] = slot;
      out.push(mk('slot', i, build.cells[i]!.id, build.cells[i]!.star, evaluate(b, o), slot));
      tick();
    }

  return out
    .filter((s) => s.gain > 1e-4)
    .sort((a, b) => b.score - a.score)
    .slice(0, o.top ?? 8);
}

/** Apply a suggestion to a build (returns a copy). */
export function applySuggestion<T extends BuildState>(build: T, s: Suggestion): T {
  const b = clone(build);
  if (s.kind === 'add' || s.kind === 'star') b.cells[s.cell] = { id: s.itemId, star: s.star };
  if (s.kind === 'slot' && s.slot) b.slotAt[s.cell] = s.slot;
  return b;
}

/** Greedy: add the best item until the tower is full, then hand out free slots. */
export function autofill(build: Build, o: OptimizeOptions = {}, onProgress?: (done: number, total: number) => void): Build {
  let b = clone(build);
  const steps = b.cells.filter((c) => !c).length + Object.values(freeSlots(b)).reduce((a, n) => a + n, 0);
  let k = 0;
  for (;;) {
    const s = suggest(b, { ...o, top: 100 }).find((x) => x.kind === 'add');
    if (!s) break;
    b = applySuggestion(b, s);
    onProgress?.(++k, steps);
  }
  // Slots never hurt, but against an enemy the build already beats they often change nothing (the kill lands on
  // the same tick). Rank them against a 4× tougher enemy so they go where they matter most.
  for (;;) {
    const tough: Build = { ...b, enemy: { ...b.enemy, hp: b.enemy.hp * 4 } };
    const s = suggest(tough, { ...o, top: 100 }).find((x) => x.kind === 'slot');
    if (!s) break;
    b = applySuggestion(b, s);
    onProgress?.(++k, steps);
  }
  return b;
}

export const itemName = (id: string): string => ITEM_BY_ID[id]?.name ?? id;
