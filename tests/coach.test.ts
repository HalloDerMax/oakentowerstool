import { describe, expect, it } from 'vitest';
import { choosePath, decide, decideEncounter, judgePick, judgeShop, matchEncounter, paths, placement, tips } from '../renderer/coach';
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
    // another item: the old label goes at once, the new one comes when frames agree
    expect(s.push(['b', null])).toEqual([null, null]);
    expect(s.push(['b', null])).toEqual(['b', null]);
    // a clear match is shown at once
    expect(s.push(['c', null], [true, false])).toEqual(['c', null]);
    // empty needs three frames (a flicker of "nothing" keeps the label)
    s.push([null, null]);
    expect(s.push([null, null])).toEqual(['c', null]);
    expect(s.push([null, null])).toEqual([null, null]);
  });
});

describe('one clear instruction', () => {
  const all = paths(have, '', 3);
  const path = choosePath(all, null);
  const base = { tower, bench: [] as string[], path, day: 6 };

  it('buy what your build needs first', () => {
    const m = decide({
      ...base,
      verdicts: judgeShop(['dark_orb', 'chopper'], have, path, all),
      hud: { gold: 50, level: 3 },
      shopOpen: true,
    });
    expect(m[0]).toMatchObject({ kind: 'buy', title: 'Buy Dark Orb', items: ['dark_orb'] });
  });

  it('merge a bench copy before anything else from the bench', () => {
    const m = decide({ ...base, bench: ['black_rose'], verdicts: [], hud: {}, shopOpen: false });
    expect(m[0]).toMatchObject({ kind: 'merge', title: 'Merge Black Rose' });
  });

  it('roll, level or save when the shop has nothing for you', () => {
    const m = decide({
      ...base,
      verdicts: judgeShop(['chopper'], have, path, all),
      hud: { gold: 80, level: 3, xp: [12, 60] },
      shopOpen: true,
    });
    expect(['roll', 'level', 'save']).toContain(m.at(-1)!.kind);
    const poor = decide({ ...base, verdicts: [], hud: { gold: 1, level: 3, xp: [12, 60] }, shopOpen: true });
    expect(poor[0]!.kind).toBe('save');
  });

  it('with the shop closed: what to look for next', () => {
    const m = decide({ ...base, verdicts: [], hud: {}, shopOpen: false });
    expect(m[0]!.kind).toBe('wait');
    expect(m[0]!.title).toMatch(/^Next: /);
  });
});

describe('encounters', () => {
  it('knows the encounter from slightly misread titles', () => {
    const seen = matchEncounter(['Healinq Touch', 'Blessinq'], 3);
    expect(seen?.enc.name).toBe('Priest');
    expect(seen?.panels).toEqual([0, 1]);
    expect(matchEncounter(['zzzz', 'qqqq'], 3)).toBeNull();
    // one title is enough
    expect(matchEncounter(['Healing Touch', ''], 3)?.panels).toEqual([0, 1]);
  });

  it('takes income early, HP when lives are low', () => {
    const seen = matchEncounter(['Healing Touch', 'Blessing'], 3)!;
    const early = decideEncounter(seen, { tower, path: null, hud: { day: 3, lives: [10, 10] }, day: 3 });
    expect(seen.enc.o[early.pick]![0]).toBe('Blessing');
    expect(early.why).toMatch(/income/);
  });

  it('follows the build rules of the site (crit build takes the crit upgrade)', () => {
    const seen = matchEncounter(['Upgrade!', 'Heavy Armor'], 4)!;
    expect(seen.enc.name).toBe('Blacksmith');
    const critPath = paths(['ruby_knife', 'emerald_sword', 'shardfang'], '', 1)[0] ?? null;
    const d = decideEncounter(seen, {
      tower: ['ruby_knife', 'emerald_sword', 'shardfang', null, null, null],
      path: critPath,
      hud: {},
      day: 4,
    });
    expect(['Upgrade!', 'Heavy Armor']).toContain(seen.enc.o[d.pick]![0]);
    expect(d.why.length).toBeGreaterThan(5);
  });

  it('the instruction says which option to take', () => {
    const m = decide({
      tower,
      bench: [],
      verdicts: [],
      path: null,
      hud: {},
      day: 3,
      shopOpen: false,
      encounter: { option: 'Blessing', text: '', why: 'income early pays back every day' },
    });
    expect(m[0]).toMatchObject({ kind: 'take', title: 'Take Blessing' });
  });
});

describe('where items go', () => {
  const all = paths(have, '', 3);
  const path = choosePath(all, null)!;
  const target = path.b.build.cells.map((c) => c?.id ?? null);

  it('finds items in the wrong cell', () => {
    // the path's first item put into the last cell
    const tower = [null, null, null, null, null, target[0]];
    const p = placement(path, tower);
    expect(p.moves[0]).toEqual({ id: target[0], from: 5, to: 0 });
    const m = decide({ tower, bench: [], verdicts: [], path, hud: {}, day: 6, shopOpen: false });
    expect(m.some((x) => x.kind === 'move' && x.title.endsWith('top left'))).toBe(true);
  });

  it('says where a bought item goes', () => {
    const missing = target.find((id) => id && !have.includes(id))!;
    const m = decide({ tower, bench: [], verdicts: judgeShop([missing], have, path, all), path, hud: {}, day: 6, shopOpen: true });
    expect(m[0]!.detail).toMatch(/It goes (top|middle|bottom) (left|right) in your tower/);
  });
});

describe('pick screens', () => {
  const all = paths(have, '', 3);
  const path = choosePath(all, null)!;
  it('takes what the build needs', () => {
    const missing = path.missing[0]!;
    expect(judgePick(['chopper', missing, 'bone_club'], have, path, all)?.best).toBe(1);
  });
  it('nothing fits: the most valuable', () => {
    const r = judgePick(['chopper', 'bone_club', 'warrior_shield'], have, path, all)!;
    expect(r.why).toMatch(/worth the most/);
    expect(r.best).toBe(2);
  });
});
