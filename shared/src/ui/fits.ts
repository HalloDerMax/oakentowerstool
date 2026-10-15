/* Which of our calculated builds fit the items you have (planner, overlay, desktop app). */
import data from '../data/builds.generated.json';
import type { OurBuild } from './buildguide';

export const BUILDS = (data as unknown as { builds: OurBuild[] }).builds;
export const itemsOf = (b: OurBuild): Set<string> =>
  new Set([...b.build.cells.filter(Boolean).map((c) => c!.id), ...b.steps.map((s) => s.itemId)]);

/** how well a build fits: shared items (finished tower counts double), same perk, then its power */
export function fit(b: OurBuild, owned: string[], perk: string): { score: number; have: string[]; missing: string[] } {
  const final = new Set(b.build.cells.filter(Boolean).map((c) => c!.id));
  const any = itemsOf(b);
  const mine = [...new Set(owned)];
  const have = mine.filter((id) => any.has(id));
  const score =
    mine.reduce((s, id) => s + (final.has(id) ? 2 : any.has(id) ? 1 : 0), 0) + (perk && b.forPerks.includes(perk) ? 1.5 : 0) + b.rel * 0.5;
  return { score, have, missing: [...final].filter((id) => !mine.includes(id)) };
}

/** best fitting builds, one per direction (pack idea), so the list shows different ways to go */
export function bestFits(owned: string[], perk: string, n = 4): ({ b: OurBuild } & ReturnType<typeof fit>)[] {
  return BUILDS.map((b) => ({ b, ...fit(b, owned, perk) }))
    .filter((x) => x.have.length)
    .sort((a, b) => b.score - a.score)
    .filter((x, i, all) => all.findIndex((y) => y.b.name.split(' · ')[0] === x.b.name.split(' · ')[0]) === i)
    .slice(0, n);
}
