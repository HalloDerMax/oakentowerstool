import { describe, expect, it } from 'vitest';
import { choosePath, judgeShop, paths, tips } from '../renderer/coach';
import { Stable } from '../renderer/stable';

// items of the "Nightfall · Growth" (Dark) build
const tower = ['twilight_s_edge', 'time_pendant', 'black_rose', null, null, null];
const have = tower.filter((x): x is string => !!x);

describe('coach', () => {
  const all = paths(have, '', 3);
  const path = choosePath(all, null);

  it('finds the build path your items belong to', () => {
    expect(path?.b.id).toBe('growth-dark');
    expect(path?.missing).toEqual(expect.arrayContaining(['dark_necklace', 'dark_orb', 'nightquill']));
    expect(path!.done).toBeCloseTo(0.5, 1);
  });

  it('says clearly what to buy', () => {
    const v = judgeShop(['dark_orb', 'black_rose', null, 'chopper'], have, path, all);
    expect(v[0]).toMatchObject({ tone: 'buy', badge: 'BUY · Nightfall' });
    expect(v[1]).toMatchObject({ tone: 'star', badge: 'STAR ↑' });
    expect(v[2]).toBeNull();
    expect(v[3]?.tone === 'skip' || v[3]?.tone === 'alt').toBe(true);
  });

  it('follows the path you picked', () => {
    const other = all.find((p) => p.b.id !== 'growth-dark');
    if (!other) return;
    expect(choosePath(all, other.b.id)?.b.id).toBe(other.b.id);
    expect(choosePath(all, 'gone-build')?.b.id).toBe(all[0]!.b.id);
  });

  it('coaches: buy first, then the bench, then roll or level', () => {
    const v = judgeShop(['dark_orb'], have, path, all);
    const t = tips({
      tower,
      bench: ['black_rose', 'chopper'],
      verdicts: v,
      path,
      hud: { gold: 40, level: 3, xp: [12, 60], day: 6 },
      day: 6,
    });
    expect(t[0]).toMatch(/^Buy Dark Orb/);
    expect(t.some((x) => /Black Rose on your bench: merge/.test(x))).toBe(true);
    expect(t.some((x) => /Chopper on your bench fits neither/.test(x))).toBe(true);
  });

  it('says roll or level when the shop has nothing for you', () => {
    const t = tips({ tower, bench: [], verdicts: [], path, hud: { gold: 80, level: 3, xp: [12, 60], day: 6 }, day: 6 });
    expect(t.some((x) => /^(Roll|Level up|Save your gold):/.test(x))).toBe(true);
    expect(t.some((x) => /^Look for:/.test(x))).toBe(true);
  });
});

describe('calm readings', () => {
  it('changes a place only when frames agree', () => {
    const s = new Stable(2, 3);
    expect(s.push(['a', null])).toEqual([null, null]);
    expect(s.push(['a', null])).toEqual(['a', null]);
    // one odd frame changes nothing
    expect(s.push(['b', null])).toEqual(['a', null]);
    expect(s.push(['a', null])).toEqual(['a', null]);
    // empty needs three frames
    s.push([null, null]);
    expect(s.push([null, null])).toEqual(['a', null]);
    expect(s.push([null, null])).toEqual([null, null]);
  });
});
