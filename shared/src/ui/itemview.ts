/* Presentation helpers for items (stats per star, coverage labels, synergies). */
import { abilityText } from '../core/parser';
import type { Coverage, ItemDef } from '../core/types';
import { ITEMS } from '../data/items';
import { RULES } from '../data/rules';
import { esc } from './dom';

export const STAR_LABEL = ['☆', '★', '★★', '★★★'];

/** [label, value] pairs for an item at a star level (crit, multicast, cooldown and charges do not scale) */
export function scaledStats(it: ItemDef, star: number): [string, string | number][] {
  const m = RULES.starMult[star]!,
    s = it.st || {};
  const o: [string, string | number][] = [];
  if (it.dmg) o.push(['Damage', it.dmg * m]);
  if (s.crit) o.push(['Crit', s.crit + '%']);
  if (s.mc) o.push(['Multicast', s.mc]);
  (['burn', 'poison', 'bleed', 'shock'] as const).forEach((k) => {
    if (s[k]) o.push([k[0]!.toUpperCase() + k.slice(1), s[k]! * m]);
  });
  if (s.block) o.push(['Shield', s.block * m]);
  if (s.heal) o.push(['Heal', s.heal * m]);
  if (s.charges) o.push(['Charges', s.charges]);
  o.push(['CD', it.cd + 's']);
  return o;
}

export const statsHtml = (it: ItemDef, star: number, cls = 'stats'): string =>
  '<div class="' +
  cls +
  '">' +
  scaledStats(it, star)
    .map((x) => '<span>' + esc(x[0]) + ' <b>' + esc(x[1]) + '</b></span>')
    .join('') +
  '</div>';

export const COVERAGE_LABEL: Record<Coverage, string> = {
  full: '✔ fully simulated',
  partial: '◐ partly simulated',
  stats: '○ only base stats simulated',
  none: '— no ability',
};

/** main number shown in the tower pill: damage, else shield (sh), heal (hl), else cooldown (cd) */
export function primaryStat(it: ItemDef, star: number): ['' | 'sh' | 'hl' | 'cd', string | number] {
  const m = RULES.starMult[star]!,
    s = it.st || {};
  if (it.dmg) return ['', Math.round(it.dmg * m)];
  if (s.block) return ['sh', Math.round(s.block * m)];
  if (s.heal) return ['hl', Math.round(s.heal * m)];
  return ['cd', it.cd + 's'];
}

export const firstAbility = (it: ItemDef): string => {
  for (let s = 3; s >= 0; s--) {
    const t = abilityText(it, s);
    if (t) return t;
  }
  return '';
};

export const typeLabel = (it: ItemDef): string => (it.type === 'R' ? 'Ranged' : 'Melee');

/* ---------- synergies: heuristically derived from ability text (tag/pack/name of B mentioned in A) ---------- */
export interface Synergy {
  boosts: ItemDef[];
  boostedBy: ItemDef[];
}
let SYN: Record<string, Synergy> | null = null;

export function synergies(id: string): Synergy {
  if (!SYN) SYN = buildSynergies();
  return SYN[id] || { boosts: [], boostedBy: [] };
}

function buildSynergies(): Record<string, Synergy> {
  const out: Record<string, Synergy> = {};
  const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  const patterns = new Map<string, RegExp[]>();
  ITEMS.forEach((b) => {
    const words = [b.tag, b.pack, b.pack2, b.name].filter((w): w is string => !!w).map((w) => w.toLowerCase());
    patterns.set(
      b.id,
      words.map((w) => new RegExp('\\b' + reEsc(w.endsWith('s') ? w.slice(0, -1) : w) + '(s|es)?\\b')),
    );
  });
  ITEMS.forEach((a) => (out[a.id] = { boosts: [], boostedBy: [] }));
  ITEMS.forEach((a) => {
    const txt = a.ab
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replace(/[^a-z' ]/g, ' ');
    ITEMS.forEach((b) => {
      if (a === b) return;
      if (patterns.get(b.id)!.some((re) => re.test(txt))) {
        out[a.id]!.boosts.push(b);
        out[b.id]!.boostedBy.push(a);
      }
    });
  });
  return out;
}
