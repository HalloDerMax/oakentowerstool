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
