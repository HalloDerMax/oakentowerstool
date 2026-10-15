/* Guide for calculated builds (Builds tab): perks, phase cards (swipe) that build on each other, synergies, damage sources.
 * Everything comes from our data: perk effects + slot unlock days, item abilities, shop odds, how-to-get.
 */
import { perkSlots } from '../core/engine';
import { abilityText } from '../core/parser';
import { ITEM_BY_ID } from '../data/items';
import { PERK_BY_ID } from '../data/perks';
import { copiesForStar, PHASES } from '../data/progression';
import { SLOT_BY_ID } from '../data/slots';
import { howToGetShort } from '../data/sources';
import { encountersFor } from '../data/encounterfit';
import type { BuildState } from '../core/types';
import { defaultState, encodeBuild } from '../state/store';
import { esc, fmt } from './dom';
import { icon, itemIcon, perkIcon } from './icon';
import { scaledStats, synergies } from './itemview';
import { shareHref } from './router';
import { slotArt } from './slotart';

export interface OurStep {
  phase: string;
  day: number;
  k: 'start' | 'buy' | 'swap' | 'slot';
  itemId: string;
  cell: number;
  replaced?: string;
  slot?: string;
  seen?: number;
  winRate: number;
  avgTime: number;
}
type MiniBuild = Pick<BuildState, 'cells' | 'slotAt' | 'perks' | 'day' | 'level'>;
export interface OurPhase {
  id: string;
  winRate: number;
  avgTime: number;
  level: number;
  enemyHp: number;
  items: { id: string; star: number }[];
  build: MiniBuild;
}
export interface OurBuild {
  id: string;
  name: string;
  mechanic: string;
  blurb: string;
  packs: string[];
  /** the one perk of the build ([] = perk-less build for perks that do not change the fight) */
  perks: string[];
  /** perks this build is listed for */
  forPerks: string[];
  /** how much of the perk the simulator models: the fight, only the shop, or nothing */
  model: 'combat' | 'shop' | 'none';
  build: MiniBuild;
  power: number;
  /** power of the tower at the end of day 8 */
  early: number;
  rank: number;
  rel: number;
  tier: string;
  sources: { name: string; share: number }[];
  steps: OurStep[];
  phases: OurPhase[];
}

const nm = (id: string) => ITEM_BY_ID[id]?.name ?? id;
const pct = (x: number) => Math.round(x * 100) + '%';
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
/** "why": the item's stats at that star plus the first sentence of its ability */
const why = (id: string, star: number) => {
  const it = ITEM_BY_ID[id];
  if (!it) return '';
  const stats = scaledStats(it, star)
    .filter(([k]) => k !== 'CD')
    .map(([k, v]) => v + ' ' + k.toLowerCase())
    .join(' · ');
  const t = abilityText(it, star);
  const s = t ? t.split(/(?<=\.)\s/)[0]! : '';
  const ab = s.length > 110 ? s.slice(0, 107) + '…' : s;
  return [(star ? star + '★: ' : '') + (stats || 'no stats'), ab].filter(Boolean).join(' — ');
};
const link = (name: string, b: MiniBuild) =>
  shareHref(encodeBuild({ ...defaultState(), name: name.slice(0, 28), ...JSON.parse(JSON.stringify(b)), potions: [] }));

/** perks shown for a build: its own perk, or the perk whose list it is shown in */
const perksOf = (b: OurBuild, perk?: string) => (b.perks.length ? b.perks : perk ? [perk] : []);

function summary(b: OurBuild, perk?: string): string {
  const perks = perksOf(b, perk).map((p) => PERK_BY_ID[p]?.name ?? p);
  const start = b.steps.filter((s) => s.k === 'start').map((s) => nm(s.itemId));
  const p1 = b.steps.filter((s) => s.phase === 'p1' && s.k === 'buy').map((s) => nm(s.itemId));
  const p2 = b.steps.filter((s) => s.phase === 'p2' && s.k === 'buy').map((s) => nm(s.itemId));
  const swaps = b.steps.filter((s) => s.k === 'swap').map((s) => nm(s.itemId) + ' for ' + nm(s.replaced!));
  const src = b.sources[0];
  return [
    (perks.length ? 'Pick <b>' + esc(list(perks)) + '</b>' : 'Pick any perk that only changes gold or the shop') +
      (b.packs.length ? ' and play the <b>' + esc(list(b.packs)) + '</b> pack' + (b.packs.length > 1 ? 's' : '') : '') +
      '.',
    start.length ? 'You start with ' + esc(list(start)) + '.' : '',
    p1.length
      ? 'In days 1–4 buy <b>' +
        esc(list(p1)) +
        '</b>' +
        (p2.length ? ', then complete the tower with <b>' + esc(list(p2)) + '</b> in days 5–8' : '') +
        '.'
      : '',
    swaps.length ? 'Later swap in ' + esc(list(swaps)) + '.' : 'Keep the tower and buy copies to raise the stars.',
    src ? 'Most damage comes from ' + esc(src.name) + ' (' + pct(src.share) + ').' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function perksHtml(b: OurBuild, perk?: string): string {
  const ids = perksOf(b, perk);
  const slots = perkSlots(ids);
  const note =
    b.model === 'shop'
      ? '<p class="og-model">The fight is the same as without the perk; we model its effect on the shop (more items seen, extra copies).</p>'
      : b.model === 'none'
        ? '<p class="og-model">' +
          (ids.length ? esc(PERK_BY_ID[ids[0]!]?.name ?? '') + ' does' : 'These perks do') +
          ' not change the fight, so this build is calculated without a perk. It also fits ' +
          esc(
            list(
              b.forPerks
                .filter((x) => !ids.includes(x))
                .map((x) => PERK_BY_ID[x]?.name ?? x)
                .slice(0, 6),
            ),
          ) +
          (b.forPerks.length > 7 ? ' and more' : '') +
          '.</p>'
        : '';
  if (!ids.length) return '<h5>Perk</h5>' + note;
  return (
    '<h5>Perk</h5><div class="og-perks">' +
    ids
      .map((id) => {
        const p = PERK_BY_ID[id];
        if (!p) return '';
        const own = slots.filter((s) => s.perk === id);
        return (
          '<div class="og-perk">' +
          perkIcon(id, p.name) +
          '<div><b>' +
          esc(p.name) +
          '</b><p>' +
          esc(p.effect) +
          '</p>' +
          (own.length
            ? '<small>' +
              own.map((s) => esc(SLOT_BY_ID[s.slot]?.name ?? s.slot) + (s.day ? ' from day ' + s.day : ' from the start')).join(' · ') +
              '</small>'
            : '') +
          '</div></div>'
        );
      })
      .join('') +
    '</div>' +
    note
  );
}

function phaseCards(b: OurBuild, perk?: string): string {
  const cards = PHASES.map((ph, i) => {
    const res = b.phases.find((x) => x.id === ph.id);
    const steps = b.steps
      .filter((s) => s.phase === ph.id)
      .sort((x, y) => x.day - y.day || (x.k === 'slot' ? 1 : 0) - (y.k === 'slot' ? 1 : 0));
    const prev = i ? b.phases.find((x) => x.id === PHASES[i - 1]!.id) : null;
    const rows = steps
      .map((s) => {
        const it = ITEM_BY_ID[s.itemId];
        if (s.k === 'slot')
          return (
            '<li class="og-step slot"><span class="og-day">Day ' +
            s.day +
            '</span>' +
            slotArt(s.slot!, 'sm') +
            '<span class="og-txt"><b>' +
            esc(SLOT_BY_ID[s.slot!]?.name ?? s.slot) +
            ' → ' +
            esc(nm(s.itemId)) +
            '</b><small>' +
            esc(SLOT_BY_ID[s.slot!]?.desc ?? '') +
            '</small></span></li>'
          );
        const verb = s.k === 'start' ? 'Start' : s.k === 'swap' ? 'Swap in' : 'Buy';
        return (
          '<li class="og-step ' +
          s.k +
          '"><span class="og-day">Day ' +
          s.day +
          '</span>' +
          itemIcon(s.itemId, nm(s.itemId), res?.items.find((x) => x.id === s.itemId)?.star ?? 0, 'sm') +
          '<span class="og-txt"><b>' +
          verb +
          ' ' +
          esc(nm(s.itemId)) +
          (s.replaced ? ' <i>for ' + esc(nm(s.replaced)) + '</i>' : '') +
          '</b>' +
          '<small>' +
          esc(why(s.itemId, res?.items.find((x) => x.id === s.itemId)?.star ?? 0)) +
          '</small>' +
          '<small class="og-src">' +
          (it ? esc(howToGetShort(it)) : '') +
          (s.seen != null ? ' · ' + pct(s.seen) + ' chance to see it in these days' : '') +
          '</small></span>' +
          (it && s.k !== 'start' ? '<em>' + it.cost + 'g</em>' : '') +
          '</li>'
        );
      })
      .join('');
    // stars to aim for = copies to buy again
    const ups = (res?.items || [])
      .map((x) => ({ ...x, before: prev?.items.find((p) => p.id === x.id)?.star ?? 0 }))
      .filter((x) => x.star > x.before)
      .map(
        (x) =>
          '<li>' +
          itemIcon(x.id, nm(x.id), x.star, 'sm') +
          '<span>' +
          esc(nm(x.id)) +
          ' → <b>' +
          x.star +
          '★</b><small>buy ' +
          (copiesForStar(x.star) - copiesForStar(x.before)) +
          ' more ' +
          (copiesForStar(x.star) - copiesForStar(x.before) === 1 ? 'copy' : 'copies') +
          ' and combine (' +
          copiesForStar(x.star) +
          ' in total)</small></span></li>',
      )
      .join('');
    return (
      '<section class="rd-card og-card" aria-roledescription="phase" aria-label="' +
      esc(ph.name) +
      '">' +
      '<header><span class="rd-n">' +
      (i + 1) +
      '/' +
      PHASES.length +
      '</span><h5>' +
      esc(ph.name) +
      '</h5><small>level ' +
      ph.levels[0] +
      '–' +
      ph.levels[1] +
      '</small></header>' +
      (rows ? '<ol class="og-steps">' + rows + '</ol>' : '<p class="rd-note">No new items – keep the tower.</p>') +
      (ups ? '<h6>Level up (buy copies)</h6><ul class="og-ups">' + ups + '</ul>' : '') +
      (res
        ? '<div class="rd-res' +
          (res.winRate >= 0.5 ? ' ok' : '') +
          '"><b>' +
          pct(res.winRate) +
          '</b> win vs ' +
          fmt(res.enemyHp) +
          ' HP<small>test enemy at the end of ' +
          esc(ph.name.toLowerCase()) +
          (res.winRate > 0 ? ' · ' + res.avgTime + 's' : '') +
          '</small></div>' +
          '<a class="ap-ghost og-open" href="' +
          link(b.name + ' ' + ph.name, { ...res.build, perks: perksOf(b, perk) }) +
          '">Open this stage in the Builder</a>'
        : '') +
      '</section>'
    );
  }).join('');
  return (
    '<div class="rd" data-rounds>' +
    '<div class="rd-head"><h5>Phase by phase</h5><span class="rd-pos" aria-live="polite">1 / ' +
    PHASES.length +
    '</span>' +
    '<button type="button" class="ap-ghost rd-prev" aria-label="Previous phase">‹</button><button type="button" class="ap-ghost rd-next" aria-label="Next phase">›</button></div>' +
    '<div class="rd-track" tabindex="0" aria-label="Phases, swipe or use the arrow keys">' +
    cards +
    '</div>' +
    '<div class="rd-dots" aria-hidden="true">' +
    PHASES.map((_, i) => '<i class="' + (i ? '' : 'on') + '"></i>').join('') +
    '</div></div>'
  );
}

function synergyHtml(b: OurBuild): string {
  const ids = b.build.cells.filter(Boolean).map((c) => c!.id);
  const pairs: string[] = [];
  ids.forEach((a) =>
    synergies(a)
      .boosts.filter((x) => ids.includes(x.id))
      .forEach((x) =>
        pairs.push(
          '<li>' +
            itemIcon(a, nm(a), b.build.cells.find((c) => c?.id === a)?.star ?? 0, 'sm') +
            '<span><b>' +
            esc(nm(a)) +
            '</b> → ' +
            esc(x.name) +
            '<small>' +
            esc(why(a, 3)) +
            '</small></span></li>',
        ),
      ),
  );
  return pairs.length ? '<h5>Why the items work together</h5><ul class="og-syn">' + pairs.slice(0, 6).join('') + '</ul>' : '';
}

/** encounter choices that help the build, by day (shared with the Community guides) */
export function encountersHtml(b: { cells: MiniBuild['cells']; packs: string[]; mechanic: string }): string {
  const picks = encountersFor(b);
  if (!picks.length) return '';
  return (
    '<h5>Encounters to take <small>pick this option when you meet them</small></h5><ul class="og-enc">' +
    picks
      .map(
        (p) =>
          '<li>' +
          icon(p.encounter, 'sm') +
          '<span><b>' +
          esc(p.encounter) +
          ' <i>' +
          (p.day ? 'day ' + p.day : 'any day') +
          '</i></b><span class="og-encopt">→ ' +
          esc(p.option) +
          '</span><small>' +
          esc(p.why) +
          ' · ' +
          esc(p.text) +
          '</small></span></li>',
      )
      .join('') +
    '</ul>'
  );
}

export function ourGuideHtml(b: OurBuild, perk?: string): string {
  return (
    '<div class="mg og" role="region" aria-label="Guide for ' +
    esc(b.name) +
    '">' +
    '<p class="mg-sum">' +
    summary(b, perk) +
    '</p>' +
    perksHtml(b, perk) +
    phaseCards(b, perk) +
    encountersHtml({ cells: b.build.cells, packs: b.packs, mechanic: b.mechanic }) +
    '<div class="mg-cols"><div>' +
    synergyHtml(b) +
    '</div><div>' +
    (b.sources.length
      ? '<h5>Damage comes from <small>finished tower</small></h5>' +
        b.sources
          .map(
            (s) =>
              '<div class="mg-src"><span>' +
              esc(s.name) +
              '</span><i style="width:' +
              Math.max(4, s.share * 100) +
              '%"></i><b>' +
              pct(s.share) +
              '</b></div>',
          )
          .join('')
      : '') +
    '</div></div>' +
    '<p class="disc">Built by our simulator from perk, item and shop data. Each pick weighs its damage gain against the chance to see it in the shop at that level; ' +
    'stars come from combining copies (1★ = 2, 2★ = 4, 3★ = 8) and are capped by phase because gold is limited. The shop is random – take the next item on the list when it shows up.</p>' +
    '</div>'
  );
}
