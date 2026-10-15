/* Desktop overlay panel: the planner overlay plus the screen reading.
 * Every ~1.5 s it asks the app for the calibrated shop / tower boxes, finds the items in them and
 *   - fills your tower (when "auto tower" is on),
 *   - rates every shop item for your tower and sends the badges to the hints layer above the game.
 */
import '../shared/src/styles/tokens.css';
import '../shared/src/styles/base.css';
import '../shared/src/styles/overlay.css';
import './desktop.css';

import { evaluate } from '../shared/src/core/optimize';
import { sanitizePlan } from '../shared/src/core/planlink';
import type { Build } from '../shared/src/core/types';
import { ITEMS, ITEM_BY_ID } from '../shared/src/data/items';
import { PERKS, PERK_BY_ID } from '../shared/src/data/perks';
import { levelOnDay, PHASES } from '../shared/src/data/progression';
import { slug } from '../shared/src/data/slug';
import { defaultState } from '../shared/src/state/store';
import { esc } from '../shared/src/ui/dom';
import { bestFits } from '../shared/src/ui/fits';
import { installIconFallback } from '../shared/src/ui/icon';
import { rateSuggestions, type Rated } from '../shared/src/ui/obtainview';
import { mountOverlay, type OverlayView } from '../shared/src/ui/overlay';
import { runSuggest } from '../shared/src/ui/simclient';
import { bgraToRgba, cells as splitCells, type Facing, type Img, type Match } from './recognize';
import type { RecRequest, RecResponse } from './recognize.worker';
import type { DesktopApi, DesktopState, HintSlot } from './bridge';

const api = (window as unknown as { oakenDesktop?: DesktopApi }).oakenDesktop;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;

/* ---------- plan state: kept by the app and shared live with the website planner (when linked) ---------- */
const KEY = 'ot-desktop-plan';
const CELLS = 6;
interface Plan {
  cells: ({ id: string; star: number } | null)[];
  perk: string;
  day: number;
}
const plan: Plan = (() => {
  const empty: Plan = { cells: new Array(CELLS).fill(null), perk: '', day: 1 };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Plan | null;
    if (!s || !Array.isArray(s.cells)) return empty;
    return {
      cells: new Array(CELLS).fill(null).map((_, i) => (s.cells[i] && ITEM_BY_ID[s.cells[i]!.id] ? s.cells[i] : null)),
      perk: PERK_BY_ID[s.perk] ? s.perk : '',
      day: Math.max(1, Math.min(16, s.day | 0 || 1)),
    };
  } catch {
    return empty;
  }
})();
const save = () => {
  if (api) return api.setPlan({ cells: plan.cells, perk: plan.perk, day: plan.day });
  try {
    localStorage.setItem(KEY, JSON.stringify(plan));
  } catch {
    /* forgets */
  }
};
/** a plan from the app (start, or a change made in the website planner) */
function applyPlan(x: unknown): void {
  const p = sanitizePlan(
    x,
    (id) => !!ITEM_BY_ID[id],
    (id) => !!PERK_BY_ID[id],
  );
  if (!p) return;
  plan.cells = p.cells;
  plan.perk = p.perk;
  plan.day = p.day;
  const sel = document.querySelector<HTMLSelectElement>('#d-perk');
  if (sel) sel.value = plan.perk;
  shopKey = '';
  refresh();
  clearTimeout(timer);
  timer = window.setTimeout(() => void compute(), 250);
}
const phaseOf = (day: number) => PHASES.find((p) => day >= p.days[0] && day <= p.days[1]) ?? PHASES[PHASES.length - 1]!;
const owned = () => plan.cells.filter(Boolean) as { id: string; star: number }[];
function planBuild(cells = plan.cells): Build {
  const ph = phaseOf(plan.day);
  return {
    ...defaultState(),
    cells: cells.map((c) => (c ? { ...c } : null)),
    slotAt: new Array(CELLS).fill(null),
    perks: plan.perk ? [plan.perk] : [],
    potions: [],
    level: levelOnDay(plan.day),
    name: 'Overlay',
    day: plan.day,
    enemy: { ...ph.enemy },
  };
}

/* ---------- best next buys (same as the planner) ---------- */
let next: Rated[] | null = null;
let busy = false;
let seq = 0;
async function compute(): Promise<void> {
  const id = ++seq;
  if (!owned().length) {
    next = null;
    return refresh();
  }
  busy = true;
  refresh();
  try {
    const packs = [...new Set(owned().flatMap((x) => [ITEM_BY_ID[x.id]!.pack, ITEM_BY_ID[x.id]!.pack2]))].filter((p): p is string => !!p);
    const onlyNeutral = packs.every((p) => p === 'Neutral');
    const r = await runSuggest(planBuild(), { top: 24, addStar: 0, packs: onlyNeutral ? [] : [...new Set([...packs, 'Neutral'])] });
    if (id !== seq) return;
    next = rateSuggestions(r, planBuild(), 6).ok;
  } catch {
    next = [];
  }
  busy = false;
  refresh();
}
let timer = 0;
function changed(): void {
  save();
  refresh();
  shopKey = '';
  clearTimeout(timer);
  timer = window.setTimeout(() => void compute(), 250);
}

function view(): OverlayView {
  const ph = phaseOf(plan.day);
  const p = plan.perk ? PERK_BY_ID[plan.perk] : undefined;
  const g = owned().length
    ? bestFits(
        owned().map((x) => x.id),
        plan.perk,
      )[0]
    : undefined;
  return {
    day: plan.day,
    level: levelOnDay(plan.day),
    phase: ph.name,
    enemyHp: ph.enemy.hp,
    perk: p ? { id: p.id, name: p.name } : undefined,
    cells: plan.cells,
    next,
    busy,
    goal: g ? { name: g.b.name, missing: g.missing } : undefined,
  };
}

/* ---------- screen reading ---------- */
let state: DesktopState | null = null;
let iconsSent: Promise<void> | null = null;
const rec = new Worker(new URL('./recognize.worker.ts', import.meta.url), { type: 'module' });
let recSeq = 0;
/** last result per slot, keyed by a fingerprint of its pixels: unchanged slots are not searched again */
const memo = new Map<string, Match | null>();
function fingerprint(img: Img): string {
  let h = 2166136261;
  // every 7th byte is enough to notice a change
  for (let i = 0; i < img.data.length; i += 7) h = Math.imul(h ^ (img.data[i]! >> 3), 16777619);
  return img.w + 'x' + img.h + ':' + (h >>> 0).toString(36);
}
async function identifyAll(slots: Img[], facing: Facing): Promise<(Match | null)[]> {
  const keys = slots.map((s) => facing + fingerprint(s));
  const todo = slots.map((s, i) => (memo.has(keys[i]!) ? null : s));
  if (todo.some(Boolean)) {
    const id = ++recSeq;
    const res = await new Promise<RecResponse>((resolve) => {
      const on = (e: MessageEvent<RecResponse>) => {
        if (e.data.id !== id) return;
        rec.removeEventListener('message', on);
        resolve(e.data);
      };
      rec.addEventListener('message', on);
      rec.postMessage({ op: 'identify', id, slots: todo, facing } satisfies RecRequest);
    });
    res.matches.forEach((m, i) => {
      if (todo[i]) memo.set(keys[i]!, m);
    });
    if (memo.size > 400) memo.clear();
  }
  return keys.map((k) => memo.get(k) ?? null);
}
let scanMsg = 'Not calibrated';
let shop: ({ id: string; score: number } | null)[] = [];
let shopKey = '';
let verdicts: (HintSlot | null)[] = [];

/** the item pictures go to the recognition worker once */
function sendIcons(): Promise<void> {
  if (iconsSent) return iconsSent;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const icons: { id: string; img: Img }[] = [];
  iconsSent = Promise.all(
    ITEMS.map(
      (it) =>
        new Promise<void>((res) => {
          const img = new Image();
          img.onload = () => {
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0);
            const d = ctx.getImageData(0, 0, c.width, c.height);
            icons.push({ id: it.id, img: { w: d.width, h: d.height, data: d.data } });
            res();
          };
          img.onerror = () => res();
          img.src = import.meta.env.BASE_URL + 'img/' + slug(it.name) + '.png';
        }),
    ),
  ).then(() => rec.postMessage({ op: 'icons', icons } satisfies RecRequest));
  return iconsSent;
}

const toImg = (c: { w: number; h: number; data: Uint8Array; bgra?: boolean } | null): Img | null =>
  c ? { w: c.w, h: c.h, data: c.bgra ? bgraToRgba(c.data) : c.data } : null;

let scanning = false;
async function scan(): Promise<void> {
  if (!api || scanning || !state?.config.scan) return;
  const cfg = state.config;
  if (!cfg.shop?.length && !cfg.tower) {
    scanMsg = 'Not calibrated: Ctrl+Shift+K';
    return paintStatus();
  }
  scanning = true;
  try {
    await sendIcons();
    const shot = await api.capture();
    if (!shot) return;
    if (cfg.shop?.length) {
      // every row split into its places; the game shows shop items as drawn
      const slots = shot.shop.flatMap((c, r) => {
        const img = toImg(c);
        return img ? splitCells(img, cfg.shop![r]!.n, 1) : [];
      });
      shop = await identifyAll(slots, 'normal');
      const key = shop.map((m) => m?.id ?? '-').join(',') + '|' + plan.cells.map((c) => (c ? c.id + c.star : '-')).join(',');
      if (key !== shopKey) {
        shopKey = key;
        void rateShop(key);
      }
    }
    const towerImg = toImg(shot.tower);
    if (towerImg && cfg.tower && cfg.autoTower) {
      // the game draws the items in your tower mirrored
      const seen = await identifyAll(splitCells(towerImg, cfg.tower.cols, cfg.tower.rows), 'mirrored');
      let diff = false;
      seen.slice(0, CELLS).forEach((m, i) => {
        const cur = plan.cells[i] ?? null;
        if ((m?.id ?? null) === (cur?.id ?? null)) return;
        plan.cells[i] = m ? { id: m.id, star: 0 } : null;
        diff = true;
      });
      if (diff) changed();
    }
    const found = shop.filter(Boolean).length;
    scanMsg = cfg.shop?.length
      ? found
        ? found + ' shop item' + (found > 1 ? 's' : '') + ' seen'
        : 'Shop: nothing seen'
      : 'Scanning tower';
  } catch (e) {
    scanMsg = 'Scan failed: ' + (e instanceof Error ? e.message : String(e));
  } finally {
    scanning = false;
    paintStatus();
  }
}

/** rate every shop item for the current tower: add it to a free cell, star an owned copy, or replace the weakest fit */
async function rateShop(key: string): Promise<void> {
  const ids = shop.map((m) => m?.id ?? null);
  const base = evaluate(planBuild(), { seeds: 3 });
  const free = plan.cells.findIndex((c) => !c);
  const res: (HintSlot | null)[] = [];
  for (const id of ids) {
    await new Promise((r) => setTimeout(r, 0));
    if (key !== shopKey) return;
    if (!id) {
      res.push(null);
      continue;
    }
    const nm = ITEM_BY_ID[id]?.name ?? id;
    const at = plan.cells.findIndex((c) => c?.id === id && c.star < 3);
    let best = { gain: -Infinity, win: 0, share: 0, how: '' };
    const tryCells = (cells: Plan['cells'], how: string) => {
      const ev = evaluate(planBuild(cells), { seeds: 3 });
      const gain = ev.score - base.score;
      if (gain > best.gain) best = { gain, win: ev.winRate, share: ev.dmgShare, how };
    };
    if (at >= 0) {
      // one more copy: counts towards the next star (2^star copies)
      const c = plan.cells.slice();
      c[at] = { id, star: plan.cells[at]!.star + 1 };
      tryCells(c, 'copy for ' + (plan.cells[at]!.star + 1) + '★');
      best.gain /= 2 ** plan.cells[at]!.star;
    }
    if (free >= 0) {
      const c = plan.cells.slice();
      c[free] = { id, star: 0 };
      tryCells(c, 'new');
    } else
      for (let i = 0; i < CELLS; i++) {
        if (plan.cells[i]?.id === id) continue;
        const c = plan.cells.slice();
        c[i] = { id, star: 0 };
        tryCells(c, 'replaces ' + (ITEM_BY_ID[plan.cells[i]!.id]?.name ?? ''));
      }
    res.push({
      id,
      name: nm,
      gain: best.gain,
      win: best.win,
      share: best.share,
      how: best.how,
      tone: 'skip',
      rect: { x: 0, y: 0, w: 0, h: 0 },
    });
  }
  if (key !== shopKey) return;
  // tones: the best positive one is "buy", other clear gains "good"
  const top = Math.max(...res.map((r) => (r ? r.gain : -Infinity)));
  // where each place is on screen: rows one after the other, each split evenly
  const places = (state?.config.shop ?? []).flatMap((s) =>
    Array.from({ length: s.n }, (_, i) => ({ x: s.x + (s.w / s.n) * i, y: s.y, w: s.w / s.n, h: s.h })),
  );
  verdicts = res.map((r, i) => {
    if (!r || !places[i]) return null;
    r.tone = r.gain > 0.02 && r.gain === top ? 'buy' : r.gain > 0.02 ? 'good' : 'skip';
    r.rect = places[i]!;
    return r;
  });
  api?.sendHints({ slots: verdicts });
  paintShop();
}

/* ---------- page ---------- */
function paintStatus(): void {
  const s = state;
  const on = !!s?.config.scan;
  $('#d-status').innerHTML =
    '<i class="d-dot ' +
    (on && (s?.config.shop?.length || s?.config.tower) ? 'on' : '') +
    '"></i><span>' +
    esc(on ? scanMsg : 'Scan paused') +
    '</span>';
  $('#d-scan').textContent = on ? 'Pause scan' : 'Scan';
  $('#d-lock').textContent = s?.locked ? 'Locked' : 'Lock';
  $<HTMLInputElement>('#d-auto').checked = !!s?.config.autoTower;
  const op = Math.round((s?.config.opacity ?? 1) * 100);
  const range = $<HTMLInputElement>('#d-op');
  if (document.activeElement !== range) range.value = String(op);
  $('#d-opv').textContent = op + '%';
}
function paintShop(): void {
  const box = $('#d-shop');
  const list = verdicts.filter(Boolean) as HintSlot[];
  box.innerHTML = list.length
    ? '<h4>Shop now</h4><ul>' +
      list
        .map(
          (v) =>
            '<li class="t-' +
            v.tone +
            '"><img src="' +
            import.meta.env.BASE_URL +
            'img/' +
            slug(v.name) +
            '.png" alt=""><span><b>' +
            esc(v.name) +
            '</b><small>' +
            esc(label(v)) +
            '</small></span><em>' +
            (v.tone === 'buy' ? 'BUY' : v.tone === 'good' ? 'ok' : 'skip') +
            '</em></li>',
        )
        .join('') +
      '</ul>'
    : '';
}
const label = (v: HintSlot): string =>
  (v.win > 0 ? Math.round(v.win * 100) + '% win' : Math.round(v.share * 100) + '% of enemy HP') +
  (v.how && v.how !== 'new' ? ' · ' + v.how : '');

let refreshOverlay: () => void = () => undefined;
const refresh = () => refreshOverlay();

function perkSelect(): string {
  return (
    '<select id="d-perk" aria-label="Your perk"><option value="">No perk</option>' +
    [...PERKS]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => '<option value="' + p.id + '"' + (p.id === plan.perk ? ' selected' : '') + '>' + esc(p.name) + '</option>')
      .join('') +
    '</select>'
  );
}

function init(): void {
  installIconFallback();
  document.body.className = 'ov-body d-panel';
  document.body.innerHTML =
    '<header class="d-bar"><b>Oaken Tower</b><span class="d-status" id="d-status"></span>' +
    '<button type="button" class="d-x" id="d-hide" title="Hide (Ctrl+Shift+O)">–</button><button type="button" class="d-x" id="d-quit" title="Quit">×</button></header>' +
    '<div class="d-tools"><button type="button" class="ov-btn" id="d-cal" title="Ctrl+Shift+K">Calibrate</button><button type="button" class="ov-btn" id="d-scan" title="Ctrl+Shift+S">Scan</button><button type="button" class="ov-btn" id="d-lock" title="Click-through; Ctrl+Shift+L unlocks">Lock</button>' +
    '<label class="d-auto"><input type="checkbox" id="d-auto"> auto tower</label>' +
    '<label class="d-op" title="See-through: Ctrl+Shift+Up / Down"><span>◐</span><input type="range" id="d-op" min="20" max="100" step="5" aria-label="Panel opacity"><b id="d-opv"></b></label></div>' +
    '<div class="d-perk">' +
    perkSelect() +
    '<button type="button" class="ov-btn" id="d-clear">Clear tower</button></div>' +
    '<div id="d-ov"></div><section class="d-shop" id="d-shop"></section>' +
    (api ? '' : '<p class="d-note">Open this page in the Oaken Tower Overlay app to read the shop.</p>');

  refreshOverlay = mountOverlay($('#d-ov'), view, {
    day(d) {
      plan.day = Math.max(1, Math.min(16, plan.day + d));
      changed();
    },
    take(i) {
      const s = next?.[i];
      if (!s) return;
      if (s.kind === 'star') plan.cells[s.cell] = { id: s.itemId, star: s.star };
      else {
        const at = plan.cells[s.cell] ? plan.cells.findIndex((c) => !c) : s.cell;
        if (at < 0) return;
        plan.cells[at] = { id: s.itemId, star: 0 };
      }
      changed();
    },
    star(i, d) {
      const c = plan.cells[i];
      if (!c) return;
      const n = Math.max(0, Math.min(3, c.star + d));
      if (n === c.star) return;
      c.star = n;
      changed();
    },
  });

  $('#d-perk').addEventListener('change', (e) => {
    plan.perk = (e.target as HTMLSelectElement).value;
    changed();
  });
  $('#d-clear').addEventListener('click', () => {
    plan.cells = new Array(CELLS).fill(null);
    changed();
  });
  $('#d-cal').addEventListener('click', () => api?.calibrate());
  $('#d-scan').addEventListener('click', () => void api?.set({ scan: !state?.config.scan }));
  $('#d-lock').addEventListener('click', () => api?.lock(!state?.locked));
  $('#d-op').addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    $('#d-opv').textContent = v + '%';
    void api?.set({ opacity: v / 100 });
  });
  $('#d-auto').addEventListener('change', (e) => void api?.set({ autoTower: (e.target as HTMLInputElement).checked }));
  $('#d-hide').addEventListener('click', () => api?.hide());
  $('#d-quit').addEventListener('click', () => api?.quit());

  if (api) {
    api.onState((s) => {
      const recal = JSON.stringify(s.config.shop) !== JSON.stringify(state?.config.shop);
      state = s;
      if (recal) {
        shopKey = '';
        verdicts = [];
        api.sendHints({ slots: [] });
        paintShop();
      }
      paintStatus();
    });
    api.onPlan((m) => {
      if (m.client !== 'app') applyPlan(m.plan);
    });
    void api.getPlan().then((p) => p && applyPlan(p));
    void api.state().then((s) => {
      state = s;
      paintStatus();
    });
    window.setInterval(() => void scan(), 1500);
  }
  if (owned().length) void compute();
}

init();
