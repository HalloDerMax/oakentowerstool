/* Game overlay for the planner: a small always-on-top window (Document Picture-in-Picture, Chrome/Edge)
 * that floats over Oaken Tower and shows the planned tower, optionally with tips (best next buys, the build
 * you are heading for, roll or level). It mirrors the planner: changes on either side show on both.
 * Browsers without the API get a normal popup window instead (not on top of the game by itself).
 * The game itself is never read: the overlay only knows what you put into the planner.
 */
import { advise, SHOP_RARITIES, type ShopRarity } from '../core/economy';
import { ITEM_BY_ID } from '../data/items';
import { esc, fmt } from './dom';
import { itemIcon, perkIcon } from './icon';
import { obtainChip, type Rated } from './obtainview';

export interface OverlayView {
  day: number;
  level: number;
  phase: string;
  enemyHp: number;
  perk?: { id: string; name: string };
  cells: ({ id: string; star: number } | null)[];
  next: Rated[] | null;
  busy: boolean;
  /** the closest calculated build and what it still needs */
  goal?: { name: string; missing: string[] };
  /** read from the game by the desktop app: your gold and the XP still missing to the next level */
  gold?: number;
  xpToNext?: number;
}
export interface OverlayActions {
  day(delta: number): void;
  take(i: number): void;
  star(cell: number, delta: number): void;
}

interface PipApi {
  requestWindow(o: { width: number; height: number }): Promise<Window>;
}
const pipApi = (): PipApi | undefined => (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture;
/** true where the overlay stays on top of other windows */
export const overlayOnTop = (): boolean => !!pipApi();

const TIPS_KEY = 'ot-overlay-tips';
let win: Window | null = null;
let gold = '';
let tips = (() => {
  try {
    return localStorage.getItem(TIPS_KEY) !== '0';
  } catch {
    return true;
  }
})();

export const overlayOpen = (): boolean => !!win && !win.closed;

/** copy the page's styles into the overlay window, so it looks like the site */
function copyStyles(to: Document): void {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = to.createElement('style');
      style.textContent = Array.from(sheet.cssRules, (r) => r.cssText).join('\n');
      to.head.appendChild(style);
    } catch {
      if (!sheet.href) continue;
      const link = to.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      to.head.appendChild(link);
    }
  }
}

/** render the overlay into a box of any document (Picture-in-Picture window, popup or the desktop app) and
 * handle its clicks; returns the refresh function */
export function mountOverlay(box: HTMLElement, view: () => OverlayView, act: OverlayActions, onTips?: (on: boolean) => void): () => void {
  const refresh = () => {
    box.innerHTML = html(view());
  };
  box.classList.add('ov');
  box.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-ov]');
    if (!t) return;
    const k = t.dataset.ov!;
    if (k === 'day-') act.day(-1);
    else if (k === 'day+') act.day(1);
    else if (k === 'tips') {
      tips = !tips;
      try {
        localStorage.setItem(TIPS_KEY, tips ? '1' : '0');
      } catch {
        /* forgets the choice */
      }
      onTips?.(tips);
      refresh();
    } else if (k.startsWith('take:')) act.take(Number(k.slice(5)));
  });
  let wheelAt = 0;
  box.addEventListener(
    'wheel',
    (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-ovcell]');
      if (!cell) return;
      e.preventDefault();
      if (performance.now() - wheelAt < 140) return;
      wheelAt = performance.now();
      act.star(Number(cell.dataset.ovcell), e.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );
  box.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id !== 'ov-gold') return;
    gold = t.value;
    const adv = box.querySelector('#ov-advice');
    if (adv) adv.outerHTML = adviceHtml(view());
  });
  refresh();
  return refresh;
}
export const overlayTips = (): boolean => tips;

let refreshWin: (() => void) | null = null;
export async function openOverlay(view: () => OverlayView, act: OverlayActions): Promise<void> {
  if (overlayOpen()) {
    win!.focus();
    return refreshOverlay();
  }
  const size = { width: 340, height: tips ? 560 : 300 };
  const api = pipApi();
  const w = api ? await api.requestWindow(size) : window.open('', 'oaken-overlay', 'popup,width=' + size.width + ',height=' + size.height);
  if (!w) throw new Error('The browser blocked the window. Allow popups for this site.');
  win = w;
  const d = w.document;
  d.title = 'Oaken Tower overlay';
  const base = d.createElement('base');
  base.href = location.href;
  d.head.appendChild(base);
  copyStyles(d);
  d.body.className = 'ov-body';
  const box = d.createElement('div');
  d.body.appendChild(box);
  // grow / shrink the window with the content (popups only; Picture-in-Picture keeps its size)
  refreshWin = mountOverlay(box, view, act, (on) => {
    if (!api) w.resizeTo(size.width, on ? 560 : 300);
  });
  w.addEventListener('pagehide', () => {
    win = null;
    refreshWin = null;
  });
}

export function refreshOverlay(): void {
  if (overlayOpen()) refreshWin?.();
}

const stars = (n: number) => (n ? '<span class="ov-stars">' + '★'.repeat(n) + '</span>' : '');

function towerHtml(v: OverlayView): string {
  return (
    '<div class="ov-tower">' +
    v.cells
      .map((c, i) => {
        if (!c) return '<div class="ov-cell empty"></div>';
        const it = ITEM_BY_ID[c.id];
        if (!it) return '<div class="ov-cell empty"></div>';
        return (
          '<div class="ov-cell r-' +
          it.rarity +
          '" data-ovcell="' +
          i +
          '" title="Mouse wheel: stars">' +
          itemIcon(c.id, it.name, c.star) +
          '<b>' +
          esc(it.name) +
          '</b>' +
          stars(c.star) +
          '</div>'
        );
      })
      .join('') +
    '</div>'
  );
}

/** the rarity of the best next buy, which is what you roll for */
function wanted(v: OverlayView): ShopRarity {
  const id = v.next?.find((s) => s.kind === 'add')?.itemId;
  const r = id ? ITEM_BY_ID[id]?.rarity : undefined;
  return (SHOP_RARITIES as readonly string[]).includes(r ?? '') ? (r as ShopRarity) : 'Rare';
}

function adviceHtml(v: OverlayView): string {
  // typed gold wins; otherwise the gold the desktop app read from the game
  const g = gold ? Number(gold) : v.gold;
  if (g === undefined || !Number.isFinite(g))
    return '<p class="ov-advice" id="ov-advice">Type your gold to see whether to roll or level.</p>';
  const rarity = wanted(v);
  const a = advise({ level: v.level, gold: g, rarity, daysLeft: Math.max(0, 16 - v.day), xpToNext: v.xpToNext });
  const label = a.action === 'roll' ? 'Roll' : a.action === 'level' ? 'Level up' : 'Save gold';
  return (
    '<p class="ov-advice ' +
    a.action +
    '" id="ov-advice"><b>' +
    label +
    '</b> <small>for ' +
    rarity +
    '</small><br>' +
    esc(a.reason) +
    '</p>'
  );
}

function tipsHtml(v: OverlayView): string {
  const next =
    v.busy && !v.next
      ? '<p class="ov-dim">Testing every option…</p>'
      : !v.next?.length
        ? '<p class="ov-dim">' +
          (v.cells.some(Boolean) ? 'Nothing makes this set stronger right now.' : 'Add your items in the planner.') +
          '</p>'
        : '<ol class="ov-next">' +
          v.next
            .slice(0, 3)
            .map(
              (s, i) =>
                '<li>' +
                itemIcon(s.itemId, ITEM_BY_ID[s.itemId]?.name ?? s.itemId, s.star, 'sm') +
                '<span><b>' +
                (s.kind === 'star'
                  ? esc(ITEM_BY_ID[s.itemId]?.name ?? '') + ' ' + s.star + '★'
                  : s.kind === 'slot'
                    ? 'Slot'
                    : esc(ITEM_BY_ID[s.itemId]?.name ?? '')) +
                '</b><small>' +
                (s.winRate > 0 ? Math.round(s.winRate * 100) + '% win' : Math.round(s.dmgShare * 100) + '% of enemy HP') +
                ' ' +
                obtainChip(s.ob) +
                '</small></span>' +
                (s.kind !== 'slot'
                  ? '<button type="button" class="ov-btn" data-ov="take:' + i + '">' + (s.kind === 'star' ? 'Apply' : 'Add') + '</button>'
                  : '') +
                '</li>',
            )
            .join('') +
          '</ol>';
  const goal = v.goal
    ? '<h4>Heading for</h4><p class="ov-goal"><b>' +
      esc(v.goal.name) +
      '</b>' +
      (v.goal.missing.length
        ? '<span class="ov-miss">' +
          v.goal.missing
            .slice(0, 6)
            .map((id) => itemIcon(id, ITEM_BY_ID[id]?.name ?? id, 0, 'sm'))
            .join('') +
          '</span>'
        : '<small>complete</small>') +
      '</p>'
    : '';
  return (
    '<section class="ov-tips"><h4>Best next buys</h4>' +
    next +
    goal +
    '<h4>Roll or level</h4><label class="ov-gold">Gold <input id="ov-gold" type="number" min="0" inputmode="numeric" value="' +
    esc(gold) +
    '" placeholder="' +
    (v.gold !== undefined ? v.gold + ' from game' : '') +
    '"></label>' +
    adviceHtml(v) +
    '</section>'
  );
}

function html(v: OverlayView): string {
  return (
    '<header class="ov-head">' +
    (v.perk ? perkIcon(v.perk.id, v.perk.name, 'sm') : '') +
    '<span class="ov-title"><b>' +
    (v.perk ? esc(v.perk.name) : 'No perk') +
    '</b><small>Level ' +
    v.level +
    ' · ' +
    esc(v.phase) +
    ' · ' +
    fmt(v.enemyHp) +
    ' HP</small></span>' +
    '<span class="ov-day"><button type="button" class="ov-btn" data-ov="day-" aria-label="Previous day">−</button><b>Day ' +
    v.day +
    '</b><button type="button" class="ov-btn" data-ov="day+" aria-label="Next day">+</button></span></header>' +
    towerHtml(v) +
    (tips ? tipsHtml(v) : '') +
    '<footer class="ov-foot"><button type="button" class="ov-btn" data-ov="tips">' +
    (tips ? 'Hide tips' : 'Show tips') +
    '</button><small>Wheel over an item: stars</small></footer>'
  );
}
