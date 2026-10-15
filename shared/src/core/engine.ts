/* Combat simulator
 * Tick based (RULES.dt). Reads item ability text through parseAbility, so new items work without engine changes.
 * Pure module: no DOM, no window – runs in the main thread, a Web Worker or Node (tests).
 */
import { ITEM_BY_ID } from '../data/items';
import { PERKS } from '../data/perks';
import { POTION_BY_ID } from '../data/potions';
import { RULES } from '../data/rules';
import { SLOTS } from '../data/slots';
import { abilityText, coverage, normType, parseAbility } from './parser';
import type {
  Act,
  Build,
  Cond,
  Debuff,
  EventName,
  ItemDef,
  ManyResult,
  ParsedAbility,
  PerkSim,
  SimOptions,
  SimResult,
  ItemReport,
  SlotDef,
  StatMap,
  Target,
} from './types';

const DEBUFFS: Debuff[] = ['burn', 'poison', 'bleed', 'shock'];

/** mulberry32 – seeded so results are reproducible */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Estimated max HP for a player level (RULES.levelHp, clamped). */
export const maxHp = (level: number): number => RULES.levelHp[Math.max(1, Math.min(level, RULES.levelHp.length - 1))]!;

/** current numeric value of a slot on a given day */
export function slotValue(slot: SlotDef | null | undefined, day: number): number {
  if (!slot || !slot.stat) return 0;
  const step = slot.step || 0;
  return slot.base! + (step ? step * Math.floor(day / (slot.every || 1)) : 0);
}

/** Which slots (with the day they appear) a set of perks grants */
export function perkSlots(perkIds: string[] | null | undefined): { slot: string; day: number; perk: string }[] {
  const out: { slot: string; day: number; perk: string }[] = [];
  (perkIds || []).forEach((pid) => {
    const p = PERKS.find((x) => x.id === pid);
    if (p && p.sim && p.sim.slots) p.sim.slots.forEach((s) => out.push({ slot: s.slot, day: s.day, perk: pid }));
  });
  return out;
}

/** Runtime state of one item during a fight. */
interface SimItem {
  def: ItemDef;
  star: number;
  idx: number;
  r: number;
  c: number;
  name: string;
  dmg: number;
  cd: number;
  timer: number;
  crit: number;
  mc: number;
  burn: number;
  poison: number;
  bleed: number;
  shock: number;
  block: number;
  heal: number;
  charges: number;
  chargesLeft?: number;
  trigCount: number;
  recent: number[];
  bypass: boolean;
  slot: SlotDef | null;
  applyTimes: Record<string, number>;
  parsed: ParsedAbility;
  abilityText: string | null;
  extraTags?: Set<string>;
  artillery?: boolean;
  /** 1 if the item lifesteals on hit; lsTimes = how often per hit ("This Lifesteals 2 times") */
  lifesteal: number;
  lsTimes: number;
  /** damage of the last hit (what a Lifesteal heals) */
  lastDealt: number;
  night?: boolean;
}

/** dynamic numeric stat access ("dmg", "burn", "block" …) */
const addTo = (it: SimItem, key: string, v: number): void => {
  const o = it as unknown as Record<string, number>;
  o[key] = (o[key] || 0) + v;
};
const getS = (it: SimItem, key: string): number => (it as unknown as Record<string, number>)[key] || 0;

function matchType(it: SimItem, type: string | undefined): boolean {
  if (!type || type === 'item' || type === 'all') return true;
  const d = it.def;
  const lo = (s: string | null | undefined) => (s || '').toLowerCase();
  if (lo(d.tag) === type || lo(d.pack) === type || lo(d.pack2) === type || lo(d.name) === type) return true;
  if (type === 'melee') return d.type === 'M';
  if (type === 'ranged') return d.type === 'R';
  if ((DEBUFFS as string[]).includes(type)) return getS(it, type) > 0;
  if (it.extraTags && it.extraTags.has(type)) return true;
  return false;
}

/* ================= one side of a fight =================
 * A side = a tower (items, perks, slots, potions) with its own body (HP, shield, debuffs it has received).
 * It attacks `foe`, which is either the dummy test enemy (simulate) or the other tower (simulateVersus).
 */

/** HP, shield and the debuff stacks on a fighter */
interface Body {
  maxhp: number;
  hp: number;
  shield: number;
  burn: number;
  poison: number;
  bleed: number;
  shock: number;
  /** "enemy reaches x% HP" effects that already fired (keyed by the attacker's item) */
  lowDone: Record<string, boolean>;
}
const body = (hp: number, shield = 0): Body => ({ maxhp: hp, hp, shield, burn: 0, poison: 0, bleed: 0, shock: 0, lowDone: {} });

/** the parts of a build a side needs */
export type SideBuild = Pick<Build, 'cells' | 'slotAt' | 'perks' | 'potions' | 'day' | 'level' | 'rows' | 'cols'>;

interface Clock {
  T: number;
}

function createSide(build: SideBuild, _opts: SimOptions, rand: () => number, clock: Clock, log: (m: string) => void) {
  const rules = RULES;
  const rows = build.rows,
    cols = build.cols;
  const day = build.day || 1;
  const sims: PerkSim[] = (build.perks || [])
    .map((id) => PERKS.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => p.sim || {});
  // Chosen / Turtle: heals and shields can crit (in the perk text since patch v0.6.5)
  const healCrit = sims.some((s) => s.healCrit);
  const shieldCrit = sims.some((s) => s.shieldCrit);
  const slotDay: Record<string, number> = {};
  perkSlots(build.perks).forEach((s) => {
    slotDay[s.slot] = s.day;
  });

  const G = { critMult: rules.critMult, burnFaster: 0, shockTimes: 1, socExtra: 0, shockDmg: rules.shockBase, lifestealMaxHp: 0 };
  sims.forEach((s) => {
    if (s.shockDmg && day >= s.shockDmg.day) G.shockDmg += s.shockDmg.n;
  });

  const P = body(maxHp(build.level || 1));
  let E: Body = body(1); // replaced by setFoe()
  const bySource: Record<string, number> = {};
  let total = 0,
    opCount = 0;

  /* ---------- items ---------- */
  const items: SimItem[] = [];
  const at: (SimItem | null)[] = new Array(rows * cols).fill(null);
  (build.cells || []).forEach((c, idx) => {
    if (!c) return;
    const def = ITEM_BY_ID[c.id];
    if (!def) return;
    const star = Math.max(0, Math.min(3, c.star || 0));
    const m = rules.starMult[star]!;
    const st = def.st || {};
    const ptxt = abilityText(def, star);
    const it: SimItem = {
      def,
      star,
      idx,
      r: Math.floor(idx / cols),
      c: idx % cols,
      name: def.name,
      dmg: (def.dmg || 0) * m,
      cd: def.cd,
      timer: 0,
      crit: st.crit || 0,
      mc: st.mc || 0,
      burn: (st.burn || 0) * m,
      poison: (st.poison || 0) * m,
      bleed: (st.bleed || 0) * m,
      shock: (st.shock || 0) * m,
      block: (st.block || 0) * m,
      heal: (st.heal || 0) * m,
      charges: st.charges || 0,
      lifesteal: st.lifesteal || 0,
      lsTimes: 1,
      lastDealt: 0,
      trigCount: 0,
      recent: [],
      bypass: false,
      slot: null,
      applyTimes: {},
      parsed: parseAbility(ptxt),
      abilityText: ptxt,
    };
    it.parsed.statics.forEach((s) => {
      if (s.s === 'applyTimes') it.applyTimes[s.stat] = Math.max(it.applyTimes[s.stat] || 1, s.n);
      if (s.s === 'critMult') G.critMult = Math.max(G.critMult, s.v);
      if (s.s === 'burnFaster') G.burnFaster = Math.max(G.burnFaster, s.v);
      if (s.s === 'shockTimes') G.shockTimes = Math.max(G.shockTimes, s.v);
      if (s.s === 'socExtra') G.socExtra += s.v;
      if (s.s === 'lifestealTimes') it.lsTimes = Math.max(it.lsTimes, s.n);
      if (s.s === 'lifestealMaxHp') G.lifestealMaxHp = Math.max(G.lifestealMaxHp, s.v);
    });
    at[idx] = it;
    items.push(it);
  });

  /* slots */
  items.forEach((it) => {
    const sid = (build.slotAt || [])[it.idx];
    const slot = sid ? SLOTS.find((s) => s.id === sid) : undefined;
    if (!slot) return;
    it.slot = slot;
    if (slot.stat) {
      addTo(it, slot.stat, slotValue(slot, day));
    } else if (sid === 'melee' && it.def.type === 'M') it.dmg *= 1.25;
    else if (sid === 'magic' && (it.def.tag === 'Spell' || /arcane|magic/i.test(it.def.pack))) it.cd *= 0.75;
    else if (sid === 'time') it.cd *= Math.pow(0.95, Math.max(0, day - (slotDay.time || 0)));
    else if (sid === 'hex') {
      const n = Math.max(1, day - (slotDay.hex == null ? 0 : slotDay.hex) + 1);
      for (let i = 0; i < n; i++) addTo(it, DEBUFFS[Math.floor(rand() * 4)]!, 1);
    } else if (sid === 'artillery' && it.def.type === 'R') it.artillery = true;
    else if (sid === 'night') it.night = true;
  });
  const rowsAt = (r: number, c: number): SimItem | null => (r < 0 || c < 0 || r >= rows || c >= cols ? null : at[r * cols + c]!);

  /* ---------- helpers ---------- */
  const dealTo = (src: SimItem | null, amount: number, o: { ignoreShield?: boolean; cat?: string } = {}): number => {
    if (amount <= 0 || E.hp <= 0) return 0;
    let dmg = amount;
    if (!o.ignoreShield && E.shield > 0) {
      const ab = Math.min(E.shield, dmg);
      E.shield -= ab;
      dmg -= ab;
    }
    dmg = Math.min(dmg, E.hp);
    E.hp -= dmg;
    total += dmg;
    const key = o.cat || (src ? src.name : '?');
    bySource[key] = (bySource[key] || 0) + dmg;
    checkLow();
    return dmg;
  };
  const checkLow = () => {
    items.forEach((it) =>
      it.parsed.effects.forEach((e, i) => {
        if (e.ev !== 'enemyLow') return;
        const k = it.idx + ':' + i;
        if (E.lowDone[k] || E.hp / E.maxhp > e.pct! / 100) return;
        E.lowDone[k] = true;
        runActs(it, e.acts, {}, 0);
      }),
    );
  };
  const perCount = (it: SimItem, per: string | null | undefined): number => {
    if (!per) return 1;
    per = per.toLowerCase().replace(/\)$/, '').trim();
    let m: RegExpMatchArray | null;
    if (per === 'star') return it.star;
    if (/unique debuff/.test(per)) return DEBUFFS.filter((d) => it[d] > 0).length;
    if ((m = per.match(/^(\d+)% crit chance$/))) return Math.floor(it.crit / +m[1]!);
    if ((m = per.match(/^unique (\w+)$/))) {
      const ty = normType(m[1]!);
      return new Set(items.filter((x) => matchType(x, ty)).map((x) => x.name)).size;
    }
    m = per.match(/^(other )?(.+)$/)!;
    const ty = normType(m[2]!);
    const other = !!m[1];
    return items.filter((x) => (!other || x !== it) && matchType(x, ty)).length;
  };
  const resolve = (it: SimItem, t: Target | undefined): SimItem[] => {
    if (!t) return [];
    const type = 'type' in t ? t.type : undefined;
    const keep = (x: SimItem | null): x is SimItem => !!x && (!type || matchType(x, type));
    if (t.t === 'self') return [it];
    if (t.t === 'adj') return [rowsAt(it.r - 1, it.c), rowsAt(it.r + 1, it.c), rowsAt(it.r, it.c - 1), rowsAt(it.r, it.c + 1)].filter(keep);
    if (t.t === 'dir') return [rowsAt(it.r + t.dir.dr, it.c + t.dir.dc)].filter(keep);
    if (t.t === 'group')
      return items.filter((x) => keep(x) && !(t.other && x === it) && !(t.excludeName && x.name.toLowerCase() === t.excludeName));
    return [];
  };
  const cond = (it: SimItem, c: Cond | undefined): boolean => {
    if (!c) return true;
    if (c.debuffGE) return Math.max(...DEBUFFS.map((d) => it[d])) >= c.debuffGE;
    if (c.minTag) {
      const [n, tag] = c.minTag;
      return items.filter((x) => matchType(x, tag)).length >= n;
    }
    if (c.only) return items.length === 1;
    if (c.uniqueTypes) return new Set(items.map((x) => x.name)).size === items.length;
    if (c.uniqueTag) {
      const tag = c.uniqueTag;
      return new Set(items.filter((x) => matchType(x, tag)).map((x) => x.name)).size === items.filter((x) => matchType(x, tag)).length;
    }
    return true;
  };
  const addStat = (x: SimItem, stats: StatMap, rand_: number, mult: number) => {
    (Object.keys(stats) as (keyof StatMap)[]).forEach((k) => addTo(x, k, stats[k]! * mult));
    for (let i = 0; i < rand_ * mult; i++) addTo(x, DEBUFFS[Math.floor(rand() * 4)]!, 1);
  };

  /* ---------- events ---------- */
  function emit(ev: EventName, src: SimItem | null, data: { amount?: number } | null, depth: number): void {
    if (depth > 6 || ++opCount > 200000) return;
    for (const it of items) {
      for (const e of it.parsed.effects) {
        if (e.ev !== ev) continue;
        if (ev === 'trig' || ev === 'critSelf' || ev === 'potionSelf') {
          if (it !== src) continue;
        } else if (ev === 'trigOther') {
          if (it === src && !e.filter!.allowSelf) continue;
          if (!src || !matchType(src, e.filter!.type)) continue;
          // "another item to the left/right": same row, neighbouring column
          if (e.filter!.side && !(src.r === it.r && src.c === it.c + (e.filter!.side === 'left' ? -1 : 1))) continue;
        } else if (ev === 'bleedOther' || ev === 'healOther' || ev === 'lifestealOther') {
          if (it === src) continue;
        }
        if (e.first && it.trigCount > e.first) continue;
        if (e.every && it.trigCount % e.every !== 0) continue;
        runActs(it, e.acts, data || {}, depth);
      }
    }
  }

  function applyDebuff(it: SimItem, stat: string, n: number, depth: number): void {
    const mult = Math.max(it.applyTimes[stat] || 1, it.applyTimes.debuffs || 1);
    n *= mult;
    if (n <= 0) return;
    (E as unknown as Record<string, number>)[stat]! += n;
    log(it.name + ' applies ' + n + ' ' + stat);
    emit('applyDebuff', it, {}, depth + 1);
    if (stat === 'burn') emit('applyBurn', it, {}, depth + 1);
    if (stat === 'bleed') emit('bleedOther', it, {}, depth + 1);
  }

  function runActs(it: SimItem, acts: Act[], ctx: { amount?: number }, depth: number): void {
    for (const a of acts) {
      if (!cond(it, a.cond)) continue;
      if (++opCount > 200000) return;
      switch (a.k) {
        case 'trig': {
          const n = a.inf ? 10 : a.times || 1;
          resolve(it, a.target).forEach((x) => {
            for (let i = 0; i < n; i++) fire(x, depth + 1);
          });
          break;
        }
        case 'trigRand': {
          const pool = items.filter((x) => x !== it && matchType(x, a.type));
          for (let i = 0; i < a.n! && pool.length; i++) fire(pool[Math.floor(rand() * pool.length)]!, depth + 1);
          break;
        }
        case 'poisonTick':
          for (let i = 0; i < a.n!; i++) tickPoison();
          break;
        case 'shockTick':
          for (let i = 0; i < a.n!; i++) tickShock();
          break;
        case 'triggerSoc':
          for (let i = 0; i < a.n!; i++) items.forEach((x) => socFor(x, depth + 1));
          break;
        case 'gainCtx':
          addTo(it, a.stat!, (ctx.amount || 0) * a.mult!);
          break;
        case 'maxhp':
          P.maxhp += a.n!;
          P.hp += a.n!;
          break;
        case 'deal':
          dealTo(it, a.n!);
          break;
        case 'dealCrit':
          dealTo(it, it.crit * a.mult!);
          break;
        case 'apply':
          applyDebuff(it, a.stat!, a.n!, depth);
          break;
        case 'chanceApply':
          if (rand() < a.p!) applyDebuff(it, a.stat!, a.n!, depth);
          break;
        case 'cleanse':
          // own debuffs (only an opposing tower applies any)
          DEBUFFS.forEach((d) => {
            if (a.pct) P[d] = Math.floor(P[d] * (1 - a.pct / 100));
            else if (a.n) P[d] = Math.max(0, P[d] - a.n);
          });
          break;
        case 'shield':
          gainShield(it, a.pctMax ? (P.maxhp * a.pctMax) / 100 : a.n!, depth);
          break;
        case 'destroyShield':
          E.shield *= 1 - a.pct! / 100;
          break;
        case 'shockDmg':
          G.shockDmg += a.n!;
          break;
        case 'cdAdd':
          it.cd = Math.max(0.1, it.cd + a.sec! * perCount(it, a.per));
          break;
        case 'cdSet':
          it.cd = a.sec!;
          it.bypass = true;
          break;
        case 'cdSetT':
          resolve(it, a.target).forEach((x) => {
            x.cd = a.sec!;
            x.bypass = true;
          });
          break;
        case 'cdPct':
          resolve(it, a.target).forEach((x) => {
            x.cd *= 1 - a.pct! / 100;
          });
          break;
        case 'cdCur':
          resolve(it, a.target).forEach((x) => {
            x.timer += a.sec!;
          });
          break;
        case 'giveCritDmg':
          resolve(it, a.target).forEach((x) => {
            x.dmg += x.crit * a.mult!;
          });
          break;
        case 'transferCrit': {
          const x = rowsAt(it.r, it.c + 1);
          if (x) {
            x.crit += it.crit * a.mult!;
            if (!a.copy) it.crit = 0;
          }
          break;
        }
        case 'give': {
          const k = perCount(it, a.per) * (a.times || 1);
          resolve(it, a.target).forEach((x) => addStat(x, a.stats!, a.rand!, k));
          break;
        }
        case 'gain':
          addStat(it, a.stats!, a.rand!, perCount(it, a.per) * (a.times || 1));
          break;
        case 'gainEq':
          addTo(it, a.stat!, it.mc);
          break;
        case 'lifesteal':
          for (let i = 0; i < (a.n || 1); i++) lifesteal(it, depth);
          break;
        case 'execute':
          E.hp = 0;
          break;
      }
    }
  }

  function gainShield(it: SimItem, amount: number, depth: number): void {
    if (amount <= 0) return;
    let v = amount;
    if (shieldCrit && rand() < it.crit / 100) v *= G.critMult;
    P.shield += v;
    emit('shieldGain', it, { amount: v }, depth + 1);
  }

  function socFor(it: SimItem, depth: number): void {
    const n = 1 + G.socExtra + (it.night ? 1 : 0);
    for (let i = 0; i < n; i++) for (const e of it.parsed.effects) if (e.ev === 'soc') runActs(it, e.acts, {}, depth);
  }

  const tickPoison = () => {
    if (E.poison > 0) {
      dealTo(null, E.poison, { ignoreShield: true, cat: 'Poison' });
      emit('poisonTick', null, {}, 1);
    }
  };
  const tickShock = () => {
    if (E.shock > 0) {
      dealTo(null, G.shockDmg, { cat: 'Shock' });
      E.shock -= 1;
      emit('shockTick', null, {}, 1);
    }
  };

  /** one activation of an item (including multicast) */
  function fire(it: SimItem, depth: number): void {
    if (depth > 6 || E.hp <= 0 || P.hp <= 0) return;
    const T = clock.T;
    // max triggers per second
    it.recent = it.recent.filter((t) => T - t < 1);
    if (it.recent.length >= rules.maxTriggersPerSecond) return;
    it.recent.push(T);
    if (it.charges !== 0 && it.chargesLeft == null) it.chargesLeft = it.charges;
    if (it.chargesLeft != null) {
      if (it.chargesLeft <= 0) return;
      it.chargesLeft--;
    }
    let reps = 1 + Math.max(0, Math.floor(it.mc));
    if (rules.multicastCountsTowardCap) {
      // every multicast repetition is a trigger too, so it uses up the per-second budget
      reps = Math.min(reps, rules.maxTriggersPerSecond - it.recent.length + 1);
      for (let k = 1; k < reps; k++) it.recent.push(T);
    }
    for (let rep = 0; rep < reps; rep++) {
      it.trigCount++;
      hit(it, depth);
      if (E.hp <= 0) break;
    }
  }

  /** Lifesteal: heal for the damage of the item's last hit (ASSUMPTION – the wiki does not give the amount).
   *  Red Rose turns part of it into permanent max HP. Fires "When you Lifesteal" / "When another item Lifesteals". */
  function lifesteal(it: SimItem, depth: number): void {
    if (depth > 6) return;
    const amount = it.lastDealt;
    if (G.lifestealMaxHp > 0) {
      const gain = amount * G.lifestealMaxHp;
      P.maxhp += gain;
      P.hp += gain;
    }
    P.hp = Math.min(P.maxhp, P.hp + amount);
    emit('lifesteal', it, { amount }, depth + 1);
    emit('lifestealOther', it, { amount }, depth + 1);
  }

  function hit(it: SimItem, depth: number): void {
    let crit: boolean;
    if (it.dmg > 0) {
      crit = rand() < it.crit / 100;
      let d = it.dmg * (crit ? G.critMult : 1);
      d += E.bleed;
      const dealt = dealTo(it, d);
      it.lastDealt = dealt;
      if (it.artillery) dealTo(it, 20);
      log(it.name + ' hits for ' + Math.round(dealt) + (crit ? ' (CRIT)' : ''));
      if (it.lifesteal > 0 && dealt > 0) for (let i = 0; i < it.lsTimes; i++) lifesteal(it, depth);
    } else crit = rand() < it.crit / 100;
    DEBUFFS.forEach((s) => {
      if (it[s] > 0) applyDebuff(it, s, it[s], depth);
    });
    if (it.block > 0) gainShield(it, it.block, depth);
    if (it.heal > 0) {
      let h = it.heal;
      if (healCrit && rand() < it.crit / 100) h *= G.critMult;
      P.hp = Math.min(P.maxhp, P.hp + h);
      emit('heal', it, { amount: h }, depth + 1);
      emit('healOther', it, { amount: h }, depth + 1);
    }
    if (crit && it.dmg > 0) {
      emit('critSelf', it, {}, depth + 1);
      emit('critAny', it, {}, depth + 1);
    }
    emit('trig', it, {}, depth);
    emit('trigOther', it, {}, depth + 1);
  }

  /* ---------- per-tick work ---------- */
  let burnT = 0,
    poisonT = 0,
    shockT = 0;
  const burnInt = () => rules.burnTick / (1 + G.burnFaster);

  return {
    items,
    self: P,
    get total() {
      return total;
    },
    bySource,
    setFoe(b: Body) {
      E = b;
    },
    /** potions (on one item or on the whole deck) – needs the foe already set */
    applyPotions() {
      (build.potions || []).forEach((pt) => {
        const def = POTION_BY_ID[pt.id];
        if (!def) return;
        const targets = pt.t === 'deck' ? items : items.filter((x) => x.idx === pt.t);
        if (!targets.length) return;
        for (let k = 0; k < (pt.n || 1); k++) {
          const fx = def.fx;
          if (fx.shockDmg) G.shockDmg += fx.shockDmg;
          targets.forEach((it) => {
            (['dmg', 'crit', 'heal', 'block', 'burn', 'poison', 'bleed', 'shock', 'mc'] as const).forEach((key) => {
              if (fx[key]) it[key] += fx[key]!;
            });
            if (fx.charges && it.charges > 0) it.charges += fx.charges;
            if (fx.cd) it.cd = Math.max(0.1, it.cd + fx.cd);
            if (fx.cdSet) {
              it.cd = fx.cdSet;
              it.bypass = true;
            }
            if (fx.tag) {
              it.extraTags = it.extraTags || new Set();
              it.extraTags.add(fx.tag);
            }
            emit('potionSelf', it, {}, 1);
          });
          emit('potionAny', null, {}, 1);
        }
      });
    },
    startOfCombat() {
      items.forEach((it) => socFor(it, 0));
    },
    /** advance item cooldowns and fire what is ready */
    fireItems(dt: number) {
      for (const it of items) {
        it.timer += dt;
        const cd = it.bypass ? Math.max(0.05, it.cd) : Math.max(rules.minCooldown, it.cd);
        if (it.timer >= cd) {
          it.timer = Math.max(0, it.timer - cd);
          fire(it, 0);
        }
      }
    },
    /** burn / poison / shock this side has put on its foe */
    tickDots(dt: number) {
      burnT += dt;
      poisonT += dt;
      shockT += dt;
      while (burnT >= burnInt()) {
        burnT -= burnInt();
        if (E.burn > 0) {
          dealTo(null, E.burn, { cat: 'Burn' });
          E.burn -= 1;
        }
      }
      while (poisonT >= rules.poisonTick) {
        poisonT -= rules.poisonTick;
        tickPoison();
      }
      while (shockT >= rules.shockTick) {
        shockT -= rules.shockTick;
        for (let i = 0; i < G.shockTimes; i++) tickShock();
      }
    },
    report(): ItemReport[] {
      return items.map((it) => ({
        name: it.name,
        star: it.star,
        triggers: it.trigCount,
        dmg: Math.round(it.dmg),
        crit: Math.round(it.crit),
        mc: it.mc,
        cd: +it.cd.toFixed(2),
        burn: it.burn,
        poison: it.poison,
        bleed: it.bleed,
        shock: it.shock,
        block: it.block,
        heal: it.heal,
        coverage: coverage(it.def, it.star),
        ability: it.abilityText,
        unparsed: it.parsed.unparsed,
      }));
    },
  };
}

/* ================= fights ================= */

/** Your tower against the test enemy (fixed HP, shield and DPS). */
export function simulate(build: Build, opts: SimOptions = {}): SimResult {
  const rules = RULES;
  const rand = rng(opts.seed == null ? 1 : opts.seed);
  const clock: Clock = { T: 0 };
  const out: SimResult = {
    result: 'timeout',
    time: 0,
    total: 0,
    dps: 0,
    enemyLeft: 0,
    playerHp: 0,
    log: [],
    timeline: [],
    bySource: {},
    warnings: [],
    items: [],
  };
  const log = (m: string) => {
    if (opts.log && out.log.length < 400) out.log.push(clock.T.toFixed(2).padStart(5) + 's  ' + m);
  };
  const A = createSide(build, opts, rand, clock, log);
  const E = body(build.enemy.hp, build.enemy.shield || 0);
  const dps = build.enemy.dps || 0;
  A.setFoe(E);
  A.applyPotions();
  A.startOfCombat();

  const P = A.self;
  const maxT = opts.maxTime || rules.maxTime,
    dt = rules.dt;
  let sampleT = 0;
  out.timeline.push({ t: 0, dmg: 0, enemy: E.hp, player: P.hp });
  let ended: SimResult['result'] | null = null;
  while (clock.T < maxT) {
    clock.T += dt;
    A.fireItems(dt);
    A.tickDots(dt);
    if (dps > 0) {
      let d = dps * dt;
      const ab = Math.min(P.shield, d);
      P.shield -= ab;
      d -= ab;
      P.hp -= d;
    }
    if (clock.T - sampleT >= 0.5) {
      sampleT = clock.T;
      out.timeline.push({ t: +clock.T.toFixed(2), dmg: Math.round(A.total), enemy: Math.max(0, E.hp), player: Math.max(0, P.hp) });
    }
    if (E.hp <= 0) {
      ended = 'win';
      break;
    }
    if (P.hp <= 0) {
      ended = 'loss';
      break;
    }
  }
  const T = clock.T;
  out.result = ended || 'timeout';
  out.time = +T.toFixed(2);
  out.total = Math.round(A.total);
  out.dps = T > 0 ? Math.round(A.total / T) : 0;
  out.enemyLeft = Math.max(0, Math.round(E.hp));
  out.playerHp = Math.max(0, Math.round(P.hp));
  out.timeline.push({ t: +T.toFixed(2), dmg: Math.round(A.total), enemy: Math.max(0, E.hp), player: Math.max(0, P.hp) });
  Object.assign(out.bySource, A.bySource);
  out.items = A.report();
  return out;
}

/* ---------- frames for the animated fight (Planner "Fight") ---------- */
export interface FightFrame {
  t: number;
  /** damage per source in this frame (item names, Burn, Poison, Bleed, Shock …) */
  dmg: Record<string, number>;
  /** triggers per tower cell in this frame */
  trig: number[];
  /** current damage per tower cell (grows with permanent stacks) */
  power: number[];
  hp: number;
  shield: number;
  heal: number;
  /** late-fight fire damage to your tower in this frame */
  fire: number;
  total: number;
  foe: { hp: number; shield: number; burn: number; poison: number; bleed: number; shock: number };
}
export interface FightReplay {
  frames: FightFrame[];
  maxHp: number;
  foeMaxHp: number;
  result: SimResult['result'];
  time: number;
  total: number;
}

/** the same fight as simulate(), recorded every `step` seconds for an animation.
 *  overtime: late-fight fire burns both towers (RULES.overtime) so every fight ends; the foe only burns when it
 *  has normal HP (the training logs never break, so there your tower burning down ends the test). */
export function simulateFrames(build: Build, opts: SimOptions = {}, step = 0.1, overtime = false): FightReplay {
  const rules = RULES;
  const rand = rng(opts.seed == null ? 1 : opts.seed);
  const clock: Clock = { T: 0 };
  const A = createSide(build, opts, rand, clock, () => undefined);
  const E = body(build.enemy.hp, build.enemy.shield || 0);
  const dps = build.enemy.dps || 0;
  A.setFoe(E);
  A.applyPotions();
  const P = A.self;
  const cells = build.cells.length;
  const frames: FightFrame[] = [];
  const lastSrc: Record<string, number> = {};
  const lastTrig = new Array(cells).fill(0);
  let lastHp = P.hp;
  let lastT = 0;
  let fireNow = 0;
  let fireTicks = 0;
  let fireT = 0;
  const foeBurns = build.enemy.hp < 1e11;
  const snap = () => {
    const dmg: Record<string, number> = {};
    for (const [k, v] of Object.entries(A.bySource)) {
      const d = v - (lastSrc[k] ?? 0);
      if (d > 0.5) dmg[k] = Math.round(d);
      lastSrc[k] = v;
    }
    const trig = new Array(cells).fill(0);
    const power = new Array(cells).fill(0);
    for (const it of A.items) {
      trig[it.idx] = it.trigCount - lastTrig[it.idx];
      lastTrig[it.idx] = it.trigCount;
      power[it.idx] = Math.round(it.dmg);
    }
    const heal = Math.max(0, P.hp - lastHp + (dps > 0 ? dps * (clock.T - lastT) : 0) + fireNow);
    lastHp = P.hp;
    lastT = clock.T;
    frames.push({
      t: +clock.T.toFixed(2),
      dmg,
      trig,
      power,
      hp: Math.max(0, Math.round(P.hp)),
      shield: Math.round(P.shield),
      heal: Math.round(heal),
      fire: Math.round(fireNow),
      total: Math.round(A.total),
      foe: {
        hp: Math.max(0, Math.round(E.hp)),
        shield: Math.round(E.shield),
        burn: Math.round(E.burn),
        poison: Math.round(E.poison),
        bleed: Math.round(E.bleed),
        shock: Math.round(E.shock),
      },
    });
    fireNow = 0;
  };
  A.startOfCombat();
  snap();
  const maxT = opts.maxTime || rules.maxTime,
    dt = rules.dt;
  let next = step;
  let result: SimResult['result'] = 'timeout';
  while (clock.T < maxT) {
    clock.T += dt;
    A.fireItems(dt);
    A.tickDots(dt);
    if (dps > 0) {
      let d = dps * dt;
      const ab = Math.min(P.shield, d);
      P.shield -= ab;
      d -= ab;
      P.hp -= d;
    }
    if (overtime && clock.T >= rules.overtime.start) {
      fireT += dt;
      if (fireT + 1e-9 >= rules.overtime.every) {
        fireT = 0;
        fireTicks++;
        const pct = rules.overtime.pct * fireTicks;
        const burn = (b: typeof P) => {
          let d = b.maxhp * pct;
          const ab = Math.min(b.shield, d);
          b.shield -= ab;
          d -= ab;
          b.hp -= d;
          return d;
        };
        fireNow += burn(P);
        if (foeBurns) burn(E);
      }
    }
    if (clock.T + 1e-9 >= next) {
      next += step;
      snap();
    }
    if (E.hp <= 0) {
      result = 'win';
      break;
    }
    if (P.hp <= 0) {
      result = 'loss';
      break;
    }
  }
  snap();
  return { frames, maxHp: P.maxhp, foeMaxHp: build.enemy.hp, result, time: +clock.T.toFixed(2), total: Math.round(A.total) };
}

/** what the other tower did in a frame of a versus replay (its hits land on your tower) */
export interface OppFrame {
  dmg: Record<string, number>;
  trig: number[];
  power: number[];
  heal: number;
  fire: number;
  total: number;
  /** status stacks on YOUR tower */
  burn: number;
  poison: number;
  bleed: number;
  shock: number;
}
export interface VersusReplay extends FightReplay {
  frames: (FightFrame & { opp: OppFrame })[];
  outcome: VersusResult['outcome'];
}

/** a versus fight recorded every `step` seconds (same rules and order as simulateVersus, plus late-fight fire) */
export function simulateVersusFrames(
  build: SideBuild & { name?: string },
  opponent: SideBuild,
  opts: SimOptions = {},
  step = 0.1,
  overtime = true,
): VersusReplay {
  const rules = RULES;
  const rand = rng(opts.seed == null ? 1 : opts.seed);
  const clock: Clock = { T: 0 };
  const A = createSide(build, opts, rand, clock, () => undefined);
  const B = createSide(opponent, opts, rand, clock, () => undefined);
  A.setFoe(B.self);
  B.setFoe(A.self);
  A.applyPotions();
  B.applyPotions();
  /** per side: what changed since the last frame */
  const recorder = (S: typeof A, cells: number) => {
    const lastSrc: Record<string, number> = {};
    const lastTrig = new Array(cells).fill(0);
    let lastHp = S.self.hp;
    return (fire: number) => {
      const dmg: Record<string, number> = {};
      for (const [k, v] of Object.entries(S.bySource)) {
        const d = v - (lastSrc[k] ?? 0);
        if (d > 0.5) dmg[k] = Math.round(d);
        lastSrc[k] = v;
      }
      const trig = new Array(cells).fill(0);
      const power = new Array(cells).fill(0);
      for (const it of S.items) {
        trig[it.idx] = it.trigCount - lastTrig[it.idx];
        lastTrig[it.idx] = it.trigCount;
        power[it.idx] = Math.round(it.dmg);
      }
      return { dmg, trig, power, hpNow: S.self.hp, lastHp, setHp: () => (lastHp = S.self.hp), fire };
    };
  };
  const recA = recorder(A, build.cells.length);
  const recB = recorder(B, opponent.cells.length);
  let fireA = 0,
    fireB = 0;
  const frames: VersusReplay['frames'] = [];
  // damage the other tower dealt this frame (to tell a heal apart from hits taken)
  let lastTotalA = 0,
    lastTotalB = 0;
  const snap = () => {
    const a = recA(fireA),
      b = recB(fireB);
    const hitA = A.total - lastTotalA,
      hitB = B.total - lastTotalB;
    lastTotalA = A.total;
    lastTotalB = B.total;
    // a tower healed if its HP dropped less than the hits it took (or rose)
    const healA = Math.max(0, a.hpNow - a.lastHp + hitB + fireA);
    const healB = Math.max(0, b.hpNow - b.lastHp + hitA + fireB);
    a.setHp();
    b.setHp();
    frames.push({
      t: +clock.T.toFixed(2),
      dmg: a.dmg,
      trig: a.trig,
      power: a.power,
      hp: Math.max(0, Math.round(A.self.hp)),
      shield: Math.round(A.self.shield),
      heal: Math.round(healA),
      fire: Math.round(fireA),
      total: Math.round(A.total),
      foe: {
        hp: Math.max(0, Math.round(B.self.hp)),
        shield: Math.round(B.self.shield),
        burn: Math.round(B.self.burn),
        poison: Math.round(B.self.poison),
        bleed: Math.round(B.self.bleed),
        shock: Math.round(B.self.shock),
      },
      opp: {
        dmg: b.dmg,
        trig: b.trig,
        power: b.power,
        heal: Math.round(healB),
        fire: Math.round(fireB),
        total: Math.round(B.total),
        burn: Math.round(A.self.burn),
        poison: Math.round(A.self.poison),
        bleed: Math.round(A.self.bleed),
        shock: Math.round(A.self.shock),
      },
    });
    fireA = fireB = 0;
  };
  A.startOfCombat();
  B.startOfCombat();
  snap();
  const maxT = opts.maxTime || rules.maxTime,
    dt = rules.dt;
  let next = step,
    tick = 0,
    fireT = 0,
    fireTicks = 0;
  let outcome: VersusResult['outcome'] = 'timeout';
  const burn = (b: typeof A.self, pct: number) => {
    let d = b.maxhp * pct;
    const ab = Math.min(b.shield, d);
    b.shield -= ab;
    d -= ab;
    b.hp -= d;
    return d;
  };
  while (clock.T < maxT) {
    clock.T += dt;
    const [first, second] = tick++ % 2 === 0 ? [A, B] : [B, A];
    first.fireItems(dt);
    second.fireItems(dt);
    first.tickDots(dt);
    second.tickDots(dt);
    if (overtime && clock.T >= rules.overtime.start) {
      fireT += dt;
      if (fireT + 1e-9 >= rules.overtime.every) {
        fireT = 0;
        fireTicks++;
        fireA += burn(A.self, rules.overtime.pct * fireTicks);
        fireB += burn(B.self, rules.overtime.pct * fireTicks);
      }
    }
    if (clock.T + 1e-9 >= next) {
      next += step;
      snap();
    }
    const aDead = A.self.hp <= 0,
      bDead = B.self.hp <= 0;
    if (aDead || bDead) {
      outcome = aDead && bDead ? 'draw' : bDead ? 'win' : 'loss';
      break;
    }
  }
  snap();
  return {
    frames,
    maxHp: A.self.maxhp,
    foeMaxHp: B.self.maxhp,
    result: outcome === 'draw' ? 'timeout' : outcome,
    outcome,
    time: +clock.T.toFixed(2),
    total: Math.round(A.total),
  };
}

/** What the opponent side did in a versus fight. */
export interface OpponentReport {
  total: number;
  dps: number;
  hpLeft: number;
  maxHp: number;
  bySource: Record<string, number>;
  items: ItemReport[];
}
export interface VersusResult extends SimResult {
  /** 'draw' when both towers fall in the same tick */
  outcome: 'win' | 'loss' | 'draw' | 'timeout';
  opponent: OpponentReport;
}

/** Your tower (build) against another tower (opponent). Both sides fire, debuff, shield and heal at the same time.
 *  The order inside a tick alternates so neither side always acts first. */
export function simulateVersus(build: SideBuild & { name?: string }, opponent: SideBuild, opts: SimOptions = {}): VersusResult {
  const rules = RULES;
  const rand = rng(opts.seed == null ? 1 : opts.seed);
  const clock: Clock = { T: 0 };
  const logs: string[] = [];
  const mk = (who: string) => (m: string) => {
    if (opts.log && logs.length < 500) logs.push(clock.T.toFixed(2).padStart(5) + 's  ' + who + m);
  };
  const A = createSide(build, opts, rand, clock, mk(''));
  const B = createSide(opponent, opts, rand, clock, mk('[Opponent] '));
  A.setFoe(B.self);
  B.setFoe(A.self);
  A.applyPotions();
  B.applyPotions();
  A.startOfCombat();
  B.startOfCombat();

  const maxT = opts.maxTime || rules.maxTime,
    dt = rules.dt;
  let sampleT = 0,
    tick = 0;
  const timeline: SimResult['timeline'] = [{ t: 0, dmg: 0, enemy: B.self.hp, player: A.self.hp }];
  let outcome: VersusResult['outcome'] = 'timeout';
  while (clock.T < maxT) {
    clock.T += dt;
    const [first, second] = tick++ % 2 === 0 ? [A, B] : [B, A];
    first.fireItems(dt);
    second.fireItems(dt);
    first.tickDots(dt);
    second.tickDots(dt);
    if (clock.T - sampleT >= 0.5) {
      sampleT = clock.T;
      timeline.push({ t: +clock.T.toFixed(2), dmg: Math.round(A.total), enemy: Math.max(0, B.self.hp), player: Math.max(0, A.self.hp) });
    }
    const aDead = A.self.hp <= 0,
      bDead = B.self.hp <= 0;
    if (aDead || bDead) {
      outcome = aDead && bDead ? 'draw' : bDead ? 'win' : 'loss';
      break;
    }
  }
  const T = clock.T;
  timeline.push({ t: +T.toFixed(2), dmg: Math.round(A.total), enemy: Math.max(0, B.self.hp), player: Math.max(0, A.self.hp) });
  return {
    result: outcome === 'draw' ? 'timeout' : outcome,
    outcome,
    time: +T.toFixed(2),
    total: Math.round(A.total),
    dps: T > 0 ? Math.round(A.total / T) : 0,
    enemyLeft: Math.max(0, Math.round(B.self.hp)),
    playerHp: Math.max(0, Math.round(A.self.hp)),
    log: logs,
    timeline,
    bySource: { ...A.bySource },
    warnings: [],
    items: A.report(),
    opponent: {
      total: Math.round(B.total),
      dps: T > 0 ? Math.round(B.total / T) : 0,
      hpLeft: Math.max(0, Math.round(B.self.hp)),
      maxHp: Math.round(B.self.maxhp),
      bySource: { ...B.bySource },
      items: B.report(),
    },
  };
}

/** Seed of run i in simulateMany – keep stable so results stay reproducible. */
export const runSeed = (i: number): number => 1000 + i * 7919;

/** average over several seeds (crits are random) */
export function simulateMany(
  build: Build,
  opts: SimOptions = {},
  runs = 20,
  onProgress?: (done: number, runs: number) => void,
): ManyResult {
  runs = runs || 20;
  const rs: SimResult[] = [];
  for (let i = 0; i < runs; i++) {
    rs.push(simulate(build, Object.assign({}, opts, { seed: runSeed(i), log: false })));
    if (onProgress) onProgress(i + 1, runs);
  }
  const first = simulate(build, Object.assign({}, opts, { seed: 1000, log: true }));
  return summarize(first, rs, runs);
}

function summarize<T extends SimResult>(first: T, rs: SimResult[], runs: number): T & ManyResult {
  const avg = (f: (r: SimResult) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  const wins = rs.filter((r) => r.result === 'win').length;
  const bs: Record<string, number> = {};
  rs.forEach((r) =>
    Object.keys(r.bySource).forEach((k) => {
      bs[k] = (bs[k] || 0) + r.bySource[k]! / runs;
    }),
  );
  return Object.assign(first, {
    summary: {
      runs,
      winRate: wins / runs,
      avgTime: +avg((r) => r.time).toFixed(2),
      avgDps: Math.round(avg((r) => r.dps)),
      avgTotal: Math.round(avg((r) => r.total)),
      minTime: Math.min(...rs.map((r) => r.time)),
      maxTime: Math.max(...rs.map((r) => r.time)),
    },
    avgBySource: bs,
  });
}

export type VersusManyResult = VersusResult &
  ManyResult & {
    versus: { lossRate: number; drawRate: number; opponentAvgBySource: Record<string, number>; opponentAvgDps: number };
  };

/** versus fight averaged over several seeds */
export function simulateVersusMany(
  build: SideBuild & { name?: string },
  opponent: SideBuild,
  opts: SimOptions = {},
  runs = 20,
  onProgress?: (done: number, runs: number) => void,
): VersusManyResult {
  runs = runs || 20;
  const rs: VersusResult[] = [];
  for (let i = 0; i < runs; i++) {
    rs.push(simulateVersus(build, opponent, Object.assign({}, opts, { seed: runSeed(i), log: false })));
    onProgress?.(i + 1, runs);
  }
  const first = simulateVersus(build, opponent, Object.assign({}, opts, { seed: 1000, log: true }));
  const many = summarize(first, rs, runs);
  const obs: Record<string, number> = {};
  rs.forEach((r) => Object.keys(r.opponent.bySource).forEach((k) => (obs[k] = (obs[k] || 0) + r.opponent.bySource[k]! / runs)));
  return Object.assign(many, {
    versus: {
      lossRate: rs.filter((r) => r.outcome === 'loss').length / runs,
      drawRate: rs.filter((r) => r.outcome === 'draw').length / runs,
      opponentAvgBySource: obs,
      opponentAvgDps: Math.round(rs.reduce((a, r) => a + r.opponent.dps, 0) / runs),
    },
  });
}

/** the opponent tower of a build as a fighting side (it fights on the same day), or null if versus is off/empty */
export function opponentSide(b: Build): SideBuild | null {
  const o = b.opponent;
  if (!b.vs || !o || !o.cells.some(Boolean)) return null;
  return { rows: b.rows, cols: b.cols, cells: o.cells, slotAt: o.slotAt, perks: o.perks, potions: o.potions, day: b.day, level: o.level };
}

/** versus fight when the build has an active opponent tower, otherwise the test enemy */
export function simulateAuto(
  build: Build,
  opts: SimOptions = {},
  runs = 20,
  onProgress?: (done: number, runs: number) => void,
): ManyResult | VersusManyResult {
  const opp = opponentSide(build);
  return opp ? simulateVersusMany(build, opp, opts, runs, onProgress) : simulateMany(build, opts, runs, onProgress);
}
