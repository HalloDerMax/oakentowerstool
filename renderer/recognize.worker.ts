/* Item recognition off the main thread: the panel sends the pictures once, then slots to identify.
 * The worker learns the scale the game draws items at (per kind of place: shop, tower, bench, pick) from clear
 * matches, and from then on only tries that size: about three times faster. */
import { identify, makeTemplate, SIZES, type Facing, type Img, type ItemTemplate, type Match } from './recognize';

/** items, or perks (the perk picture left of the tower) */
export type Group = 'items' | 'perks';
export type RecRequest =
  | { op: 'icons'; group: Group; icons: { id: string; img: Img }[] }
  | {
      op: 'identify';
      id: number;
      group: Group;
      slots: (Img | null)[];
      facing: Facing;
      /** kind of place (its own scale) */
      kind: string;
      /** item seen in each place before (fast path) */
      prev: (string | null)[];
    };
export type RecResponse = { id: number; matches: (Match | null)[] };

const sets: Record<Group, ItemTemplate[]> = { items: [], perks: [] };
/** clear matches per template size, per kind of place */
const seenSizes = new Map<string, number[]>();
function sizesFor(kind: string): number[] | undefined {
  const c = seenSizes.get(kind);
  if (!c || c.reduce((a, b) => a + b, 0) < 5) return undefined;
  const mode = c.indexOf(Math.max(...c));
  return [mode - 1, mode, mode + 1].filter((i) => i >= 0 && i < SIZES.length);
}
function learn(kind: string, m: Match | null): void {
  if (!m || m.score > 0.6 || m.next - m.score < 0.15) return;
  const c = seenSizes.get(kind) ?? new Array(SIZES.length).fill(0);
  c[m.size]++;
  seenSizes.set(kind, c);
}

self.onmessage = (e: MessageEvent<RecRequest>) => {
  const m = e.data;
  if (m.op === 'icons') {
    sets[m.group] = m.icons.map((x) => makeTemplate(x.id, x.img));
    return;
  }
  const kind = m.group + '|' + m.kind;
  const matches = m.slots.map((s, i) => {
    if (!s) return null;
    const r = identify(s, sets[m.group], undefined, m.facing, { prev: m.prev[i], sizes: sizesFor(kind) });
    learn(kind, r);
    return r;
  });
  (self as unknown as Worker).postMessage({ id: m.id, matches } satisfies RecResponse);
};
