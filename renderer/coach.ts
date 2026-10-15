/* The coach: what you have (tower + bench), which build paths fit, and a clear yes / no for every shop item.
 * Pure functions, tested in tests/coach.test.ts.
 *
 *   buy   – your build needs it and you do not have enough copies yet
 *   star  – a copy of an item of your build you already have (two copies make a star)
 *   fit   – not in a build, but from the packs you are playing (your direction)
 *   alt   – does not fit your path, but one of the other paths that fit your items
 *   skip  – fits none of them
 */
import { advise, SHOP_RARITIES, type ShopRarity } from '../shared/src/core/economy';
import type { Encounter } from '../shared/src/core/types';
import { encountersFor } from '../shared/src/data/encounterfit';
import { ENCOUNTERS } from '../shared/src/data/encounters';
import { ITEM_BY_ID } from '../shared/src/data/items';
import type { OurBuild } from '../shared/src/ui/buildguide';
import { BUILDS, fit } from '../shared/src/ui/fits';

export type Tone = 'buy' | 'star' | 'fit' | 'alt' | 'skip';
export interface Verdict {
  id: string;
  tone: Tone;
  /** short text for the badge above the item */
  badge: string;
  /** one line why */
  why: string;
}
export interface Path {
  b: OurBuild;
  have: string[];
  missing: string[];
  /** share of the finished tower you already have */
  done: number;
}
export interface HudInfo {
  day?: number;
  gold?: number;
  level?: number;
  xp?: [number, number];
  income?: number;
  luck?: number;
  chest?: string;
  odds?: number[];
  lives?: [number, number];
  trophies?: [number, number];
  hp?: [number, number];
}

const name = (id: string) => ITEM_BY_ID[id]?.name ?? id;
/** "Nightfall · Growth" → "Nightfall"; a build grown for your packs is named after them ("Goblin + Dragon") */
export const shortName = (b: OurBuild) => (b.name.startsWith('Your packs') ? b.packs.join(' + ') : b.name.split(' · ')[0]!);
/** full name for lists */
export const pathName = (b: OurBuild) => (b.name.startsWith('Your packs') ? b.packs.join(' + ') + ' (your packs)' : b.name);
const finalIds = (b: OurBuild) => b.build.cells.filter(Boolean).map((c) => c!.id);
const count = (xs: string[], id: string) => xs.filter((x) => x === id).length;

/** the packs you are playing: the two most common packs of your items (Neutral does not count) */
export function mainPacks(owned: string[]): string[] {
  const n = new Map<string, number>();
  for (const id of owned)
    for (const p of [ITEM_BY_ID[id]?.pack, ITEM_BY_ID[id]?.pack2]) if (p && p !== 'Neutral') n.set(p, (n.get(p) ?? 0) + 1);
  return [...n.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([p]) => p);
}

/** build paths that fit what you have, best first (one per direction); `extra` = builds grown for your packs */
export function paths(owned: string[], perk: string, n = 3, extra: OurBuild[] = []): Path[] {
  if (!owned.length) return [];
  return [...extra, ...BUILDS]
    .map((b) => ({ b, ...fit(b, owned, perk) }))
    .filter((x) => x.have.length)
    .sort((a, b) => b.score - a.score)
    .filter((x, i, all) => all.findIndex((y) => shortName(y.b) === shortName(x.b)) === i)
    .slice(0, n)
    .map(({ b, have, missing }) => {
      const fin = finalIds(b);
      return { b, have, missing, done: fin.length ? fin.filter((id) => owned.includes(id)).length / fin.length : 0 };
    });
}

/** the path you follow: the one you picked if it still fits, otherwise the best */
export function choosePath(all: Path[], picked: string | null): Path | null {
  return all.find((p) => p.b.id === picked) ?? all[0] ?? null;
}

export function judgeShop(shop: (string | null)[], owned: string[], path: Path | null, others: Path[]): (Verdict | null)[] {
  return shop.map((id) => {
    if (!id) return null;
    if (!path) return { id, tone: 'skip', badge: 'Skip', why: 'Add your items first: then the coach knows your build.' };
    const fin = finalIds(path.b);
    const early = new Set(path.b.steps.map((s) => s.itemId));
    const need = count(fin, id),
      have = count(owned, id);
    const short = shortName(path.b);
    if (need > have)
      return { id, tone: 'buy', badge: 'BUY · ' + short, why: name(id) + ' is part of your ' + pathName(path.b) + ' build.' };
    if (have > 0 && (need > 0 || early.has(id)))
      return { id, tone: 'star', badge: 'STAR ↑', why: 'Second copy of your ' + name(id) + ': merge it for a star.' };
    if (early.has(id) && !owned.length)
      return { id, tone: 'buy', badge: 'BUY · ' + short, why: name(id) + ' starts your ' + pathName(path.b) + ' build.' };
    if (early.has(id))
      return { id, tone: 'star', badge: 'Early · ' + short, why: name(id) + ' carries ' + pathName(path.b) + ' until its key items come.' };
    const packs = mainPacks(owned);
    const it = ITEM_BY_ID[id];
    const pack = packs.find((p) => it?.pack === p || it?.pack2 === p);
    if (pack) return { id, tone: 'fit', badge: 'Fits · ' + pack, why: name(id) + ' is a ' + pack + ' item, like most of yours.' };
    const alt = others.find((o) => o.b.id !== path.b.id && finalIds(o.b).includes(id));
    if (alt)
      return {
        id,
        tone: 'alt',
        badge: 'Switch · ' + shortName(alt.b),
        why: 'Not for ' + short + ', but fits the ' + pathName(alt.b) + ' path.',
      };
    return { id, tone: 'skip', badge: 'Skip', why: 'Fits none of your paths.' };
  });
}

/** the rarity your path still needs most (for roll or level) */
function wantedRarity(path: Path | null): ShopRarity {
  const r = path?.missing.map((id) => ITEM_BY_ID[id]?.rarity).find((x) => (SHOP_RARITIES as readonly string[]).includes(x ?? ''));
  return (r as ShopRarity) ?? 'Rare';
}

/** the coach's short to-do list, most important first */
export function tips(o: {
  tower: (string | null)[];
  bench: string[];
  verdicts: (Verdict | null)[];
  path: Path | null;
  hud: HudInfo;
  day: number;
}): string[] {
  const out: string[] = [];
  const buys = o.verdicts.filter((v): v is Verdict => v?.tone === 'buy');
  const stars = o.verdicts.filter((v): v is Verdict => v?.tone === 'star');
  if (buys.length)
    out.push('Buy ' + [...new Set(buys.map((v) => name(v.id)))].join(', ') + ' for ' + (o.path ? pathName(o.path.b) : 'your build') + '.');
  if (stars.length) out.push('Star up: ' + [...new Set(stars.map((v) => name(v.id)))].join(', ') + '.');
  // the bench: merge copies, swap in what the path needs, sell the rest
  const full = o.tower.every(Boolean);
  for (const id of o.bench) {
    if (o.tower.includes(id)) out.push(name(id) + ' on your bench: merge it with the one in your tower for a star.');
    else if (o.path && finalIds(o.path.b).includes(id)) {
      const weak = o.tower.find((t) => t && !finalIds(o.path!.b).includes(t));
      out.push(
        full
          ? name(id) + ' on your bench belongs to your build: swap it in' + (weak ? ' for ' + name(weak) : '') + '.'
          : 'Put ' + name(id) + ' from your bench into your tower.',
      );
    } else {
      const pack = mainPacks([...o.tower.filter((t): t is string => !!t), ...o.bench]).find(
        (p) => ITEM_BY_ID[id]?.pack === p || ITEM_BY_ID[id]?.pack2 === p,
      );
      out.push(
        pack
          ? name(id) + ' on your bench is a ' + pack + ' item like yours: keep it for a ' + pack + ' tower.'
          : name(id) + ' on your bench fits neither your path nor your packs: sell it.',
      );
    }
  }
  if (o.path?.missing.length && !buys.length) out.push('Look for: ' + o.path.missing.slice(0, 4).map(name).join(', ') + '.');
  // roll or level, with what the game shows
  const { gold, level, xp } = o.hud;
  if (gold !== undefined && level !== undefined) {
    const a = advise({
      level,
      gold,
      rarity: wantedRarity(o.path),
      xpToNext: xp ? Math.max(0, xp[1] - xp[0]) : undefined,
      daysLeft: Math.max(0, 16 - (o.hud.day ?? o.day)),
    });
    if (!buys.length) out.push((a.action === 'roll' ? 'Roll' : a.action === 'level' ? 'Level up' : 'Save your gold') + ': ' + a.reason);
  }
  return out;
}

/* ---------- one clear instruction ---------- */
export type MoveKind = 'move' | 'take' | 'buy' | 'star' | 'merge' | 'swap' | 'sell' | 'roll' | 'level' | 'save' | 'wait';
export interface Move {
  kind: MoveKind;
  /** the instruction, a few words ("Buy Dark Orb", "Roll", "Level up") */
  title: string;
  /** one sentence why */
  detail: string;
  /** items it is about (pictures) */
  items: string[];
}
const pct = (x: number) => (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%';
const listNames = (ids: string[]) => [...new Set(ids)].map(name).join(' + ');

/**
 * What to do now, most important first: buy for your build → star copies → bench (merge, swap, sell) →
 * buy a fitting item → roll, level or save. The first move is the instruction, the rest is "then".
 */
export function decide(o: {
  tower: (string | null)[];
  bench: string[];
  verdicts: (Verdict | null)[];
  path: Path | null;
  hud: HudInfo;
  day: number;
  /** the shop is on screen */
  shopOpen: boolean;
  /** an encounter is on screen: the option to take */
  encounter?: { option: string; text: string; why: string } | null;
  /** a pick screen (one of three items): the item to take */
  pick?: { id: string; why: string } | null;
}): Move[] {
  const out: Move[] = [];
  if (o.pick) {
    out.push({ kind: 'take', title: 'Take ' + name(o.pick.id), detail: o.pick.why, items: [o.pick.id] });
    return out;
  }
  if (o.encounter) {
    out.push({
      kind: 'take',
      title: 'Take ' + o.encounter.option,
      detail: o.encounter.why.charAt(0).toUpperCase() + o.encounter.why.slice(1) + '.',
      items: [],
    });
    return out;
  }
  const of = (t: Tone) => o.verdicts.filter((v): v is Verdict => v?.tone === t).map((v) => v.id);
  const buys = of('buy'),
    stars = of('star'),
    fits = of('fit');
  const pName = o.path ? pathName(o.path.b) : 'your build';
  const place = placement(o.path, o.tower);
  const spot = (id: string) => {
    const at = place.target.findIndex((t, i) => t === id && o.tower[i] !== id);
    return at >= 0 ? ' It goes ' + CELL_NAMES[at] + ' in your tower.' : '';
  };
  if (buys.length)
    out.push({
      kind: 'buy',
      title: 'Buy ' + listNames(buys.slice(0, 2)),
      detail: 'Your ' + pName + ' build needs it.' + spot(buys[0]!),
      items: buys.slice(0, 2),
    });
  if (stars.length)
    out.push({
      kind: 'star',
      title: 'Buy ' + listNames(stars.slice(0, 2)),
      detail: 'A second copy merges into a star.',
      items: stars.slice(0, 2),
    });
  // items in the wrong cell: neighbours work together, so the place matters
  for (const m of place.moves.slice(0, 2))
    out.push({
      kind: 'move',
      title: 'Move ' + name(m.id) + ' ' + CELL_NAMES[m.to],
      detail:
        'It is ' + CELL_NAMES[m.from] + ' now; your ' + pName + ' tower has it ' + CELL_NAMES[m.to] + ', next to the items it works with.',
      items: [m.id],
    });
  // the bench
  const fin = o.path ? finalIds(o.path.b) : [];
  const full = o.tower.every(Boolean);
  for (const id of o.bench) {
    if (o.tower.includes(id))
      out.push({
        kind: 'merge',
        title: 'Merge ' + name(id),
        detail: 'Drop the bench copy on the one in your tower: +1 star.',
        items: [id],
      });
    else if (fin.includes(id)) {
      const weak = o.tower.find((t): t is string => !!t && !fin.includes(t));
      out.push(
        full
          ? {
              kind: 'swap',
              title: 'Swap in ' + name(id),
              detail: weak ? 'Replace ' + name(weak) + ': it is not part of ' + pName + '.' : 'It belongs to ' + pName + '.',
              items: [id],
            }
          : { kind: 'swap', title: 'Place ' + name(id), detail: 'Put it from the bench into your tower.', items: [id] },
      );
    } else {
      const pack = mainPacks([...o.tower.filter((t): t is string => !!t), ...o.bench]).find(
        (p) => ITEM_BY_ID[id]?.pack === p || ITEM_BY_ID[id]?.pack2 === p,
      );
      if (!pack) out.push({ kind: 'sell', title: 'Sell ' + name(id), detail: 'Fits neither ' + pName + ' nor your packs.', items: [id] });
    }
  }
  if (!buys.length && !stars.length && fits.length)
    out.push({
      kind: 'buy',
      title: 'Buy ' + name(fits[0]!),
      detail: 'Not in ' + pName + ', but a ' + (ITEM_BY_ID[fits[0]!]?.pack ?? '') + ' item like yours.',
      items: [fits[0]!],
    });
  // nothing to buy (or after buying): roll, level or save
  const { gold, level, xp } = o.hud;
  if (o.shopOpen && gold !== undefined && level !== undefined) {
    const rarity = wantedRarity(o.path);
    const a = advise({
      level,
      gold,
      rarity,
      xpToNext: xp ? Math.max(0, xp[1] - xp[0]) : undefined,
      daysLeft: Math.max(0, 16 - (o.hud.day ?? o.day)),
    });
    const look = o.path?.missing.length ? ' Look for ' + listNames(o.path.missing.slice(0, 3)) + '.' : '';
    if (a.action === 'roll')
      out.push({
        kind: 'roll',
        title: 'Roll',
        detail:
          'Nothing more for you here. ' +
          rarity +
          ' items: ' +
          pct(a.pNow) +
          ' per shop now' +
          (a.pNext < a.pNow ? ', fewer after a level' : '') +
          '.' +
          look,
        items: o.path?.missing.slice(0, 3) ?? [],
      });
    else if (a.action === 'level')
      out.push({
        kind: 'level',
        title: 'Level up (' + a.xpGold + 'g)',
        detail:
          rarity +
          ' items get likelier: ' +
          pct(a.pNow) +
          ' → ' +
          pct(a.pNext) +
          ' per shop' +
          (a.incomeBack ? ', and +' + a.incomeBack + 'g income back' : '') +
          '.',
        items: [],
      });
    else
      out.push({ kind: 'save', title: 'Save your gold', detail: 'Not enough gold to roll or level well. Fight and come back.', items: [] });
  } else if (!o.shopOpen && !out.length)
    out.push({
      kind: 'wait',
      title: o.path ? 'Next: ' + listNames(o.path.missing.slice(0, 2)) : 'Open a shop',
      detail: o.path
        ? 'Your ' + pName + ' build still needs these. The coach answers when a shop is open.'
        : 'The coach answers when a shop is open.',
      items: o.path?.missing.slice(0, 2) ?? [],
    });
  else if (o.shopOpen && !out.length) out.push({ kind: 'roll', title: 'Roll', detail: 'Nothing here for ' + pName + '.', items: [] });
  return out;
}

/* ---------- encounters ---------- */

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
function similar(a: string, b: string): number {
  const x = letters(a),
    y = letters(b);
  if (!x || !y) return 0;
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [i, ...new Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) d[0]![j] = j;
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
  return 1 - d[x.length]![y.length]! / Math.max(x.length, y.length);
}

export interface SeenEncounter {
  enc: Encounter;
  /** which option of the encounter each panel on screen shows (index into enc.o, or null) */
  panels: (number | null)[];
}

/** the titles read on screen → the encounter (small reading errors are fine) */
export function matchEncounter(titles: string[], day?: number): SeenEncounter | null {
  let best: { enc: Encounter; panels: (number | null)[]; score: number } | null = null;
  for (const enc of ENCOUNTERS) {
    const panels: (number | null)[] = titles.map((t) => {
      let at: number | null = null,
        top = 0.7;
      enc.o.forEach(([name], i) => {
        const s = similar(t, name);
        if (s >= top) {
          top = s;
          at = i;
        }
      });
      return at;
    });
    const found = panels.filter((p) => p !== null).length;
    if (!found) continue;
    // one title read is enough: the other panel shows the option that is left
    if (panels.length === enc.o.length && found === panels.length - 1) {
      const left = enc.o.findIndex((_, i) => !panels.includes(i));
      panels[panels.indexOf(null)] = left;
    }
    const score = found + (day && enc.day === day ? 0.5 : 0);
    if (!best || score > best.score) best = { enc, panels, score };
  }
  return best ? { enc: best.enc, panels: best.panels } : null;
}

/** which option to take, and why */
export function decideEncounter(
  seen: SeenEncounter,
  o: { tower: (string | null)[]; path: Path | null; hud: HudInfo; day: number },
): { pick: number; why: string } {
  const cells = (o.path ? o.path.b.build.cells : o.tower.map((id) => (id ? { id, star: 0 } : null))) as { id: string; star: number }[];
  const rules = encountersFor({ cells, packs: o.path?.b.packs ?? [], mechanic: o.path?.b.mechanic ?? '' }, 99).filter(
    (p) => p.encounter === seen.enc.name,
  );
  const day = o.hud.day ?? o.day;
  const lowLives = !!o.hud.lives && o.hud.lives[0] <= 4;
  const scored = seen.enc.o.map(([name, text], i) => {
    const rule = rules.find((r) => r.option === name);
    let score = rule ? rule.weight * 2 : 0;
    let why = rule ? rule.why : '';
    if (/income/i.test(text)) {
      score += day <= 8 ? 2 : 0.5;
      if (!why && day <= 8) why = 'income early pays back every day';
    }
    if (/max hp|\bhp\b/i.test(text)) {
      score += lowLives ? 2.5 : 1;
      if (!why && lowLives) why = 'your lives are low: more HP keeps you in the run';
    }
    if (/gold/i.test(text) && !/income/i.test(text)) score += 0.8;
    if (/legendary|epic|forged/i.test(text)) {
      score += 1.5;
      if (!why) why = 'a strong item now';
    }
    if (/random/i.test(text)) score -= 0.3;
    return { i, score, why: why || text };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  const close = scored[1] && Math.abs(scored[1].score - top.score) < 0.3;
  return { pick: top.i, why: close ? 'both are about even; ' + top.why : top.why };
}

/* ---------- where items go in the tower ---------- */
export const CELL_NAMES = ['top left', 'top right', 'middle left', 'middle right', 'bottom left', 'bottom right'];
export interface Placement {
  /** the path's finished tower, cell by cell */
  target: (string | null)[];
  /** items you have that sit in another cell than the path wants */
  moves: { id: string; from: number; to: number }[];
}
export function placement(path: Path | null, tower: (string | null)[]): Placement {
  const target = path ? path.b.build.cells.map((c) => c?.id ?? null) : [];
  const moves: Placement['moves'] = [];
  const used = new Set<number>();
  target.forEach((id, to) => {
    if (!id || tower[to] === id) return;
    // one of yours that is not already where the path wants it
    const from = tower.findIndex((t, i) => t === id && target[i] !== id && !used.has(i));
    if (from >= 0) {
      used.add(from);
      moves.push({ id, from, to });
    }
  });
  return { target, moves };
}

/* ---------- a pick screen (choose one of three items) ---------- */
const RANK: Record<Tone, number> = { buy: 4, star: 3, fit: 2, alt: 1, skip: 0 };
/** best item to take: what your path needs, then a star copy, your packs, another path, else the most valuable */
export function judgePick(
  ids: (string | null)[],
  owned: string[],
  path: Path | null,
  others: Path[],
): { best: number; why: string } | null {
  const v = judgeShop(ids, owned, path, others);
  let best = -1;
  ids.forEach((id, i) => {
    if (!id) return;
    if (best < 0) return void (best = i);
    const a = RANK[v[i]!.tone],
      b = RANK[v[best]!.tone];
    if (a > b || (a === b && (ITEM_BY_ID[id]?.cost ?? 0) > (ITEM_BY_ID[ids[best]!]?.cost ?? 0))) best = i;
  });
  if (best < 0) return null;
  const vb = v[best]!;
  return {
    best,
    why: vb.tone === 'skip' ? 'Nothing fits your build: it is worth the most (' + (ITEM_BY_ID[vb.id]?.cost ?? 0) + 'g).' : vb.why,
  };
}
