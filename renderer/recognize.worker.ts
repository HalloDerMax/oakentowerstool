/* Item recognition off the main thread: the panel sends the pictures once, then slots to identify. */
import { identify, makeTemplate, type Facing, type Img, type ItemTemplate, type Match } from './recognize';

/** items, or perks (the perk picture left of the tower) */
export type Group = 'items' | 'perks';
export type RecRequest =
  | { op: 'icons'; group: Group; icons: { id: string; img: Img }[] }
  | { op: 'identify'; id: number; group: Group; slots: (Img | null)[]; facing: Facing };
export type RecResponse = { id: number; matches: (Match | null)[] };

const sets: Record<Group, ItemTemplate[]> = { items: [], perks: [] };
self.onmessage = (e: MessageEvent<RecRequest>) => {
  const m = e.data;
  if (m.op === 'icons') sets[m.group] = m.icons.map((x) => makeTemplate(x.id, x.img));
  else
    (self as unknown as Worker).postMessage({
      id: m.id,
      matches: m.slots.map((s) => (s ? identify(s, sets[m.group], undefined, m.facing) : null)),
    } satisfies RecResponse);
};
