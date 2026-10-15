/* Live link between the website planner and the desktop overlay app.
 * The app runs a tiny server on this PC only (127.0.0.1); the planner page connects to it when the app runs.
 */
export const LINK_PORT = 47321;
export const LINK_URL = 'http://127.0.0.1:' + LINK_PORT;

export interface LinkPlan {
  cells: ({ id: string; star: number } | null)[];
  perk: string;
  day: number;
}

/** keep only what a plan may hold; unknown items / perks are dropped by the caller's lookups */
export function sanitizePlan(x: unknown, known: (id: string) => boolean, knownPerk: (id: string) => boolean): LinkPlan | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Partial<LinkPlan>;
  if (!Array.isArray(o.cells)) return null;
  const cells = Array.from({ length: 6 }, (_, i) => {
    const c = o.cells![i] as { id?: unknown; star?: unknown } | null | undefined;
    if (!c || typeof c.id !== 'string' || !known(c.id)) return null;
    return { id: c.id, star: Math.max(0, Math.min(3, Number(c.star) | 0)) };
  });
  const perk = typeof o.perk === 'string' && knownPerk(o.perk) ? o.perk : '';
  const day = Math.max(1, Math.min(16, Number(o.day) | 0 || 1));
  return { cells, perk, day };
}

export const emptyPlan = (p: LinkPlan): boolean => !p.perk && !p.cells.some(Boolean);
