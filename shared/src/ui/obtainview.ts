/* Sorts suggestions by gain × chance to actually get the item, and splits off the ones you cannot get soon
 * (Forged without an Anvil, Legendary before level 3, Special items nothing in your tower makes). */
import { obtainability, weighted, type Obtain } from '../core/obtain';
import type { Suggestion } from '../core/optimize';
import type { Build } from '../core/types';
import { esc } from './dom';

export type Rated = Suggestion & { ob: Obtain; value: number };

export function rateSuggestions(list: Suggestion[], b: Pick<Build, 'cells' | 'day' | 'level'>, top = 8): { ok: Rated[]; hard: Rated[] } {
  const ctx = { day: b.day, level: b.level, tower: b.cells.filter(Boolean).map((c) => c!.id) };
  const rated = list.map((s): Rated => {
    if (s.kind === 'slot')
      return { ...s, ob: { kind: 'shop', chance: 1, label: 'your slot', how: 'A slot from your perk.' }, value: s.gain };
    const ob = obtainability(s.itemId, ctx);
    const before = s.kind === 'star' ? (b.cells[s.cell]?.star ?? 0) : -1;
    // copies to buy: a new item at star k needs 2^k copies, a star-up from j to k needs 2^k − 2^j more
    const copies = s.kind === 'star' ? 2 ** s.star - 2 ** before : 2 ** s.star;
    return { ...s, ob, value: weighted(s.gain, ob, copies) };
  });
  const ok = rated.filter((r) => r.ob.chance >= 0.05).sort((a, b) => b.value - a.value);
  const hard = rated
    .filter((r) => r.ob.chance < 0.05)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 3);
  return { ok: ok.slice(0, top), hard };
}

/** small chip: where the item comes from and how likely you get it soon */
export const obtainChip = (o: Obtain) =>
  '<i class="ob ob-' + o.kind + (o.chance < 0.05 ? ' no' : '') + '" title="' + esc(o.how) + '">' + esc(o.label) + '</i>';
