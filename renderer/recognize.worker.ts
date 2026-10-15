/* Item recognition off the main thread: the panel sends the icons once, then slots to identify. */
import { identify, makeTemplate, type Facing, type Img, type ItemTemplate, type Match } from './recognize';

export type RecRequest =
  { op: 'icons'; icons: { id: string; img: Img }[] } | { op: 'identify'; id: number; slots: (Img | null)[]; facing: Facing };
export type RecResponse = { id: number; matches: (Match | null)[] };

let items: ItemTemplate[] = [];
self.onmessage = (e: MessageEvent<RecRequest>) => {
  const m = e.data;
  if (m.op === 'icons') items = m.icons.map((x) => makeTemplate(x.id, x.img));
  else
    (self as unknown as Worker).postMessage({
      id: m.id,
      matches: m.slots.map((s) => (s ? identify(s, items, undefined, m.facing) : null)),
    } satisfies RecResponse);
};
