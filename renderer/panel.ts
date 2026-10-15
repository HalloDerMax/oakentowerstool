/* Desktop overlay panel: the coach.
 * About every 1.5 s one frame of the game is read (shop, tower, bench, perk; the HUD every other time):
 *   - readings are calmed (a place changes only when several frames agree),
 *   - your tower, perk, day and level are taken over (switch "auto read"),
 *   - the build paths that fit your items are listed; you pick one (or the best is used),
 *   - every shop item gets a clear label: BUY for your build, STAR ↑, Switch to another path, or Skip,
 *   - the coach lists what to do now (buy, merge, swap, sell, roll or level).
 */
import '../shared/src/styles/tokens.css';
import '../shared/src/styles/base.css';
import '../shared/src/styles/overlay.css';
import './desktop.css';

import { sanitizePlan } from '../shared/src/core/planlink';
import type { Build } from '../shared/src/core/types';
import { ITEMS, ITEM_BY_ID } from '../shared/src/data/items';
import { PERKS, PERK_BY_ID } from '../shared/src/data/perks';
import { levelOnDay, PHASES } from '../shared/src/data/progression';
import { slug } from '../shared/src/data/slug';
import { defaultState } from '../shared/src/state/store';
import { esc } from '../shared/src/ui/dom';
import { installIconFallback } from '../shared/src/ui/icon';
import { rateSuggestions, type Rated } from '../shared/src/ui/obtainview';
import { mountOverlay, type OverlayView } from '../shared/src/ui/overlay';
import { runGrow, runSuggest } from '../shared/src/ui/simclient';
import type { OurBuild } from '../shared/src/ui/buildguide';
import type { DesktopApi, DesktopConfig, DesktopState, HintSlot, Rect } from './bridge';
import { grab, stop as stopStream } from './capture';
import {
  CELL_NAMES,
  choosePath,
  decide,
  judgePick,
  placement,
  decideEncounter,
  judgeShop,
  matchEncounter,
  mainPacks,
  pathName,
  paths,
  type HudInfo,
  type Move,
  type Path,
  type Verdict,
} from './coach';
import {
  autoLayout,
  benchWindows,
  ENCOUNTER_PANELS,
  ENCOUNTER_TITLES,
  HUD_FIELDS,
  parseHud,
  PICK_BOXES,
  layoutWith,
  REF_CELL0,
  PERK_BOX,
  placeOnScreen,
  type HudKey,
} from './hud';
import { crop, cells as splitCells, type Facing, type Img, type Match } from './recognize';
import { innerCell, snapTower } from './grid';
import type { Group, RecRequest, RecResponse } from './recognize.worker';
import { Stable } from './stable';

const api = (window as unknown as { oakenDesktop?: DesktopApi }).oakenDesktop;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const nameOf = (id: string) => ITEM_BY_ID[id]?.name ?? id;
const pic = (id: string, cls = '') =>
  '<img class="' + cls + '" src="' + import.meta.env.BASE_URL + 'img/' + slug(nameOf(id)) + '.png" alt="" title="' + esc(nameOf(id)) + '">';

/* ---------- plan: kept by the app, shared live with the website planner (when linked) ---------- */
const KEY = 'ot-desktop-plan';
const PATH_KEY = 'ot-desktop-path';
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
let picked: string | null = (() => {
  try {
    return localStorage.getItem(PATH_KEY);
  } catch {
    return null;
  }
})();

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
  afterChange(false);
}
const phaseOf = (day: number) => PHASES.find((p) => day >= p.days[0] && day <= p.days[1]) ?? PHASES[PHASES.length - 1]!;
const owned = () => plan.cells.filter(Boolean) as { id: string; star: number }[];
let hud: HudInfo = {};
const level = () => hud.level ?? levelOnDay(plan.day);
function planBuild(): Build {
  const ph = phaseOf(plan.day);
  return {
    ...defaultState(),
    cells: plan.cells.map((c) => (c ? { ...c } : null)),
    slotAt: new Array(CELLS).fill(null),
    perks: plan.perk ? [plan.perk] : [],
    potions: [],
    level: level(),
    name: 'Overlay',
    day: plan.day,
    enemy: { ...ph.enemy },
  };
}

/* ---------- best next buys (simulated in the background worker, only when the plan changes) ---------- */
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
/** something in the plan changed (here, in the game or on the website): share it, coach again, simulate later */
function afterChange(share = true): void {
  if (share) save();
  coach();
  refresh();
  clearTimeout(timer);
  timer = window.setTimeout(() => void compute(), 400);
}

function view(): OverlayView {
  const ph = phaseOf(plan.day);
  const p = plan.perk ? PERK_BY_ID[plan.perk] : undefined;
  return {
    day: plan.day,
    level: level(),
    phase: ph.name,
    enemyHp: ph.enemy.hp,
    perk: p ? { id: p.id, name: p.name } : undefined,
    cells: plan.cells,
    next,
    busy,
    goal: path ? { name: path.b.name, missing: path.missing } : undefined,
    gold: hud.gold,
    xpToNext: hud.xp ? Math.max(0, hud.xp[1] - hud.xp[0]) : undefined,
  };
}

/* ---------- recognition worker ---------- */
let state: DesktopState | null = null;
/** several recognition workers: the slots of one scan are shared out, so a new shop is read in a fraction of the time */
const POOL = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
const recs = Array.from({ length: POOL }, () => new Worker(new URL('./recognize.worker.ts', import.meta.url), { type: 'module' }));
let recSeq = 0;
let picturesSent: Promise<void> | null = null;
function sendPictures(): Promise<void> {
  if (picturesSent) return picturesSent;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const load = (list: { id: string; name: string }[], group: Group) => {
    const icons: { id: string; img: Img }[] = [];
    return Promise.all(
      list.map(
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
    ).then(() => recs.forEach((w) => w.postMessage({ op: 'icons', group, icons } satisfies RecRequest)));
  };
  picturesSent = Promise.all([load(ITEMS, 'items'), load(PERKS, 'perks')]).then(() => undefined);
  return picturesSent;
}

/** coarse fingerprint (8×8 average, few colour steps): small animations like flames do not count as a change */
function fingerprint(img: Img): string {
  const g = 8,
    out: number[] = [];
  for (let gy = 0; gy < g; gy++)
    for (let gx = 0; gx < g; gx++) {
      let r = 0,
        gg = 0,
        b = 0,
        n = 0;
      const x0 = Math.floor((gx * img.w) / g),
        x1 = Math.floor(((gx + 1) * img.w) / g),
        y0 = Math.floor((gy * img.h) / g),
        y1 = Math.floor(((gy + 1) * img.h) / g);
      for (let y = y0; y < y1; y += 2)
        for (let x = x0; x < x1; x += 2) {
          const i = (y * img.w + x) * 4;
          r += img.data[i]!;
          gg += img.data[i + 1]!;
          b += img.data[i + 2]!;
          n++;
        }
      n ||= 1;
      out.push(((r / n) >> 5) * 64 + ((gg / n) >> 5) * 8 + ((b / n) >> 5));
    }
  return img.w + 'x' + img.h + ':' + out.join('.');
}
const memo = new Map<string, Match | null>();
async function identifyAll(
  slots: Img[],
  facing: Facing,
  group: Group = 'items',
  kind = 'shop',
  prev: (string | null)[] = [],
): Promise<(Match | null)[]> {
  const keys = slots.map((s) => group + facing + fingerprint(s));
  const todo = slots.map((_, i) => (memo.has(keys[i]!) ? -1 : i)).filter((i) => i >= 0);
  if (todo.length) {
    // round robin over the workers, all at the same time
    await Promise.all(
      recs.map(async (w, wi) => {
        const mine = todo.filter((_, k) => k % recs.length === wi);
        if (!mine.length) return;
        const id = ++recSeq;
        const res = await new Promise<RecResponse>((resolve) => {
          const on = (e: MessageEvent<RecResponse>) => {
            if (e.data.id !== id) return;
            w.removeEventListener('message', on);
            resolve(e.data);
          };
          w.addEventListener('message', on);
          w.postMessage({
            op: 'identify',
            id,
            group,
            slots: mine.map((i) => slots[i]!),
            facing,
            kind,
            prev: mine.map((i) => prev[i] ?? null),
          } satisfies RecRequest);
        });
        res.matches.forEach((m, k) => memo.set(keys[mine[k]!]!, m));
      }),
    );
    if (memo.size > 800) memo.clear();
  }
  return keys.map((k) => memo.get(k) ?? null);
}

/* ---------- reading the screen ---------- */
const calmShop = new Stable(2, 2);
// the tower rarely empties: a tooltip or the mouse over a cell does not clear its item
const calmTower = new Stable(2, 6);
// the bench only counts what stays: no item popping in and out
const calmBench = new Stable(3, 4);
const calmPerk = new Stable(2, 4);
const calmPick = new Stable(2, 2);
/** a pick screen on screen: the three items and where they are */
let pick: { ids: (string | null)[]; rects: Rect[] } | null = null;
let shop: (string | null)[] = [];
let bench: string[] = [];
let scanMsg = 'Not calibrated';
let tick = 0;

/** a little more than the box, so an item that is not perfectly centred is still whole */
const grow = (r: Rect, k = 0.06): Rect => ({ x: r.x - r.w * k, y: r.y - r.h * k, w: r.w * (1 + 2 * k), h: r.h * (1 + 2 * k) });
/** calibrated boxes, or the game's known layout (fullscreen / borderless needs no calibration) */
function layout(): DesktopConfig {
  const cfg = state?.config ?? {};
  if (cfg.shop?.length || cfg.tower) return cfg;
  return { ...cfg, ...(snapAt ? layoutWith(snapAt) : autoLayout(state?.display)) };
}
const calibrated = () => !!(state?.config.shop?.length || state?.config.tower);
function shopPlaces(): Rect[] {
  return (layout().shop ?? []).flatMap((s) =>
    Array.from({ length: s.n }, (_, i) => ({ x: s.x + (s.w / s.n) * i, y: s.y, w: s.w / s.n, h: s.h })),
  );
}
function towerCells(): Rect[] {
  const t = layout().tower;
  if (!t) return [];
  return Array.from({ length: t.cols * t.rows }, (_, k) => ({
    x: t.x + (t.w / t.cols) * (k % t.cols),
    y: t.y + (t.h / t.rows) * Math.floor(k / t.cols),
    w: t.w / t.cols,
    h: t.h / t.rows,
  })).slice(0, CELLS);
}

let ocr: typeof import('./ocr') | null = null;
let scanning = false;
/** the tower's cells out of one picture around it: snapped to the frames, inner part only (no signs, no star) */
/** the game's layout mapped by the tower found on screen: exact to a few pixels, so the HUD (gold, day …), shop and
 * bench boxes sit right even when the game is not exactly where the known layout expects it */
let snapAt: ((b: [number, number, number, number]) => Rect) | null = null;
function towerCutouts(area: Img | undefined, n: number, areaRect?: Rect): Img[] {
  const t = layout().tower;
  if (!area || !t) return [];
  // picture pixels per reference pixel: the area is the tower box grown by 12 % on every side
  const snap = snapTower(area, area.w / 1.24 / 365);
  if (snap && areaRect && snap.quality >= 0.5) {
    const c0 = snap.cells[0]!;
    const kx = c0.w / REF_CELL0.w,
      ky = c0.h / REF_CELL0.h;
    const fx = areaRect.w / area.w,
      fy = areaRect.h / area.h;
    snapAt = ([x, y, w, h]) => ({
      x: areaRect.x + (c0.x + (x - REF_CELL0.x) * kx) * fx,
      y: areaRect.y + (c0.y + (y - REF_CELL0.y) * ky) * fy,
      w: w * kx * fx,
      h: h * ky * fy,
    });
  }
  if (snap)
    return snap.cells.slice(0, n).map((c) => {
      const r = innerCell(c);
      return crop(area, r.x, r.y, r.w, r.h);
    });
  // no frames found (an unusual screen): the even split of the box
  const inner = crop(area, (area.w * 0.12) / 1.24, (area.h * 0.12) / 1.24, area.w / 1.24, area.h / 1.24);
  return splitCells(inner, t.cols, t.rows).slice(0, n);
}
/* ---------- encounters: read the option titles when no shop is open ---------- */
let encounter: {
  name: string;
  panels: (Rect | null)[];
  options: (string | null)[];
  pick: number;
  text: string;
  why: string;
  at: number;
} | null = null;
let lineBusy = false;
function readEncounterLater(titles: Img[], panels: Rect[]): void {
  if (lineBusy || !titles.length) return;
  lineBusy = true;
  void (async () => {
    try {
      ocr ??= await import('./ocr');
      const texts: string[] = [];
      for (const t of titles) texts.push(await ocr.readLine(t, fingerprint));
      const seen = matchEncounter(texts, hud.day ?? plan.day);
      if (!seen) return;
      const d = decideEncounter(seen, { tower: plan.cells.map((c) => c?.id ?? null), path, hud, day: plan.day });
      const before = encounter?.name + '|' + encounter?.pick;
      encounter = {
        name: seen.enc.name,
        panels: seen.panels.map((o, i) => (o === null ? null : panels[i]!)),
        options: seen.panels.map((o) => (o === null ? null : seen.enc.o[o]![0])),
        pick: d.pick,
        text: seen.enc.o[d.pick]![1],
        why: d.why,
        at: Date.now(),
      };
      if (before !== encounter.name + '|' + encounter.pick) coach();
    } catch {
      /* next time */
    } finally {
      lineBusy = false;
    }
  })();
}
/** a match this clear needs no second frame */
const sure = (m: Match | null) => !!m && m.score < 0.7 && m.next - m.score > 0.1;
let ocrBusy = false;
/** the HUD (gold, level …) is read in the background: it never holds up the item recognition */
function readHudLater(imgs: Img[]): void {
  if (ocrBusy || !imgs.length) return;
  ocrBusy = true;
  void (async () => {
    try {
      ocr ??= await import('./ocr');
      const text = await ocr.readFields(
        Object.fromEntries(HUD_FIELDS.map((f, i) => [f.key, imgs[i]!])) as Partial<Record<HudKey, Img>>,
        fingerprint,
      );
      const h = parseHud(text);
      if (JSON.stringify({ ...hud, ...h }) === JSON.stringify(hud)) return;
      hud = { ...hud, ...h };
      paintRun();
      refresh();
      if (h.day && Math.min(16, h.day) !== plan.day) {
        plan.day = Math.min(16, h.day);
        afterChange();
      } else coach();
    } catch {
      /* next time */
    } finally {
      ocrBusy = false;
    }
  })();
}
async function scan(): Promise<void> {
  if (!api || scanning || !state?.config.scan) return;
  const cfg = state.config;
  scanning = true;
  tick++;
  try {
    await sendPictures();
    // the snapped tower is the best guide to where everything else is
    const at = snapAt ?? placeOnScreen(layout(), state.display);
    const places = shopPlaces(),
      cells = towerCells(),
      // the bench changes rarely: every third scan
      windows = tick % 3 === 0 ? benchWindows().map(at) : [];
    const readHud = cfg.autoTower && !ocrBusy && tick % 6 === 1;
    const fields = readHud ? HUD_FIELDS.map((f) => at(f.box)) : [];
    const perkBox = cfg.autoTower ? [at(PERK_BOX)] : [];
    // no shop on screen: maybe an encounter (its titles are read in the background)
    const lookForEncounter = !shop.some(Boolean) && tick % 3 === 0;
    const titleBoxes = lookForEncounter ? ENCOUNTER_TITLES.map(at) : [];
    // the tower is grabbed as one piece around it; its cells are then found by their frames
    const tw = layout().tower;
    const towerArea = tw ? [grow(tw, 0.12)] : [];
    // a pick screen dims the shop: look for one only while the shop shows (almost) nothing
    const pickBoxes = pick || shop.filter(Boolean).length < 3 ? PICK_BOXES.map(at) : [];
    const imgs = await grab([...places.map((r) => grow(r)), ...towerArea, ...windows, ...perkBox, ...fields, ...titleBoxes, ...pickBoxes]);
    if (!imgs.length) return;
    let k = 0;
    const take = (n: number) => imgs.slice(k, (k += n));
    const shopImgs = take(places.length),
      towerImgs = towerCutouts(take(towerArea.length)[0], cells.length, towerArea[0]),
      benchImgs = take(windows.length),
      perkImgs = take(perkBox.length),
      hudImgs = take(fields.length),
      titleImgs = take(titleBoxes.length),
      pickImgs = take(pickBoxes.length);
    if (titleImgs.length) readEncounterLater(titleImgs, ENCOUNTER_PANELS.map(at));

    // shop as drawn; tower and bench mirrored (that is how the game shows your own items)
    // a pick screen (choose one of three items) covers the shop: read it first
    const pickRead = calmPick.push(
      (await identifyAll(pickImgs, 'normal', 'items', 'pick', pick?.ids ?? [])).map((m) => (m && m.score < 0.8 ? m.id : null)),
    );
    const pickNow = pickRead.filter(Boolean).length >= 2 ? { ids: pickRead, rects: pickBoxes } : null;
    if (JSON.stringify(pickNow?.ids) !== JSON.stringify(pick?.ids)) {
      pick = pickNow;
      coach();
    }
    // the shop first: its labels appear before tower and bench are read
    const shopRead = pick ? shopImgs.map(() => null) : await identifyAll(shopImgs, 'normal', 'items', 'shop', shop);
    // the shop's labels change right now, before the tower and bench are read
    {
      const newShop = calmShop.push(
        shopRead.map((m) => m?.id ?? null),
        shopRead.map(sure),
      );
      if (newShop.join() !== shop.join()) {
        shop = newShop;
        coach();
      }
    }
    const [towerRead, benchRead, perkRead] = await Promise.all([
      identifyAll(
        towerImgs,
        'mirrored',
        'items',
        'tower',
        plan.cells.map((c) => c?.id ?? null),
      ),
      identifyAll(benchImgs, 'mirrored', 'items', 'bench'),
      identifyAll(perkImgs, 'normal', 'perks', 'perk', [plan.perk || null]),
    ]);
    let newBench = bench;
    if (benchImgs.length) {
      const benchCalm = calmBench.push(benchRead.map((m) => m?.id ?? null));
      // neighbouring windows see the same item twice
      newBench = benchCalm.filter((id, i): id is string => !!id && benchCalm[i - 1] !== id);
    }
    let planChanged = false;
    if (cfg.autoTower) {
      calmTower
        .push(
          towerRead.map((m) => m?.id ?? null),
          towerRead.map(sure),
        )
        .forEach((id, i) => {
          const cur = plan.cells[i] ?? null;
          if ((cur?.id ?? null) === id) return;
          // a new item keeps no stars; the same item keeps the stars you set
          plan.cells[i] = id ? { id, star: 0 } : null;
          planChanged = true;
        });
      const perk = calmPerk.push(perkRead.map((m) => m?.id ?? null))[0];
      if (perk && perk !== plan.perk) {
        plan.perk = perk;
        $<HTMLSelectElement>('#d-perk').value = perk;
        planChanged = true;
      }
    }
    readHudLater(hudImgs);
    if (encounter && (shop.some(Boolean) || Date.now() - encounter.at > 6000)) {
      encounter = null;
      coach();
    }
    const shopChanged = newBench.join() !== bench.join();
    bench = newBench;
    if (planChanged) afterChange();
    else if (shopChanged) coach();
    const found = shop.filter(Boolean).length;
    scanMsg = found
      ? found + ' in shop' + (bench.length ? ' · ' + bench.length + ' on bench' : '')
      : 'Shop closed' + (calibrated() ? '' : ' · auto layout');
  } catch (e) {
    scanMsg = 'Screen not readable: ' + (e instanceof Error ? e.message : String(e));
    stopStream();
  } finally {
    scanning = false;
    paintStatus();
    // something changed but is not confirmed yet: look again right away, not at the next tick
    if (calmShop.pending() || calmTower.pending()) setTimeout(() => void scan(), 15);
  }
}

/* ---------- the coach ---------- */
let allPaths: Path[] = [];
let path: Path | null = null;
let verdicts: (Verdict | null)[] = [];
let lastHints = '';
/** builds grown for the packs you play (background worker, only when your packs or perk change) */
let grown: OurBuild[] = [];
let growKey = '';
function growFor(have: string[]): void {
  const packs = mainPacks(have);
  const key = packs.join('+') + '|' + plan.perk;
  if (!packs.length || key === growKey) return;
  growKey = key;
  void runGrow(packs, plan.perk || null)
    .then((r) => {
      if (growKey !== key) return;
      grown = r as unknown as OurBuild[];
      coach();
    })
    .catch(() => undefined);
}
function coach(): void {
  const have = [...owned().map((c) => c.id), ...bench];
  growFor(have);
  allPaths = paths(have, plan.perk, 3, grown);
  path = choosePath(allPaths, picked);
  verdicts = judgeShop(shop, have, path, allPaths);
  const places = shopPlaces();
  const pickBest = pick ? judgePick(pick.ids, have, path, allPaths) : null;
  const slots: (HintSlot | null)[] = pick
    ? pick.ids.map((id, i) =>
        id
          ? i === pickBest?.best
            ? { id, name: nameOf(id), tone: 'buy', badge: 'TAKE · ' + nameOf(id), why: pickBest.why, rect: pick!.rects[i]! }
            : { id, name: nameOf(id), tone: 'skip', badge: 'Skip', why: '', rect: pick!.rects[i]! }
          : null,
      )
    : encounter
      ? encounter.panels.map((r, i) =>
          r
            ? i === encounter!.pick || encounter!.options[i] === encounter!.options[encounter!.pick]
              ? {
                  id: 'enc' + i,
                  name: encounter!.options[i]!,
                  tone: 'buy',
                  badge: 'TAKE · ' + encounter!.options[i],
                  why: encounter!.why,
                  rect: r,
                }
              : { id: 'enc' + i, name: encounter!.options[i]!, tone: 'skip', badge: 'Skip', why: '', rect: r }
            : null,
        )
      : verdicts.map((v, i) =>
          v && places[i] ? { id: v.id, name: nameOf(v.id), tone: v.tone, badge: v.badge, why: v.why, rect: places[i]! } : null,
        );
  // on the game only what matters for you and your build: buy, star, fits, take (nothing for the rest)
  const marksOn = state?.config.marks !== false;
  const shown = slots.map((x) => (!marksOn || (x && (x.tone === 'skip' || x.tone === 'alt')) ? null : x));
  // the labels above the game only change when something really changed
  const key = JSON.stringify(shown);
  if (key !== lastHints) {
    lastHints = key;
    api?.sendHints({ slots: shown });
  }
  paintCoach();
}

/* ---------- snapshot for checking the reading ---------- */
function png(img: Img): string {
  const c = document.createElement('canvas');
  c.width = img.w;
  c.height = img.h;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  return c.toDataURL('image/png');
}
async function saveSnapshot(): Promise<void> {
  if (!api || !state) return;
  try {
    const at = snapAt ?? placeOnScreen(layout(), state.display);
    const fields = HUD_FIELDS.map((f) => at(f.box));
    const [screen, ...parts] = await grab([{ x: 0, y: 0, w: 1, h: 1 }, ...fields]);
    if (!screen) return;
    ocr ??= await import('./ocr');
    const text = await ocr.readFields(
      Object.fromEntries(HUD_FIELDS.map((f, i) => [f.key, parts[i]!])) as Partial<Record<HudKey, Img>>,
      () => String(Math.random()),
    );
    const files: Record<string, string> = { screen: png(screen) };
    HUD_FIELDS.forEach((f, i) => parts[i] && (files['hud-' + f.key] = png(parts[i]!)));
    const dir = await api.snapshot({
      files,
      info: {
        text,
        parsed: parseHud(text),
        hud,
        shop,
        bench,
        tower: plan.cells,
        perk: plan.perk,
        snapped: !!snapAt,
        layout: layout(),
        display: state.display,
        size: [screen.w, screen.h],
      },
    });
    scanMsg = 'Snapshot saved: ' + dir;
    paintStatus();
  } catch (e) {
    scanMsg = 'Snapshot failed: ' + (e instanceof Error ? e.message : String(e));
    paintStatus();
  }
}

/* ---------- page ----------
 * Top to bottom: what the game shows (one line) · THE instruction (fixed size, so nothing below jumps) ·
 * the shop · your path · tower & planner and settings folded away.
 * A part is only redrawn when its content really changed.
 */
const drawn = new WeakMap<HTMLElement, string>();
function put(el: HTMLElement, html: string): void {
  if (drawn.get(el) === html) return;
  drawn.set(el, html);
  el.innerHTML = html;
}

function paintStatus(): void {
  const s = state;
  const on = !!s?.config.scan;
  put($('#d-status'), '<i class="d-dot ' + (on ? 'on' : '') + '"></i><span>' + esc(on ? scanMsg : 'Scan paused') + '</span>');
  $('#d-scan').textContent = on ? 'Pause scan' : 'Scan';
  $('#d-lock').textContent = s?.locked ? 'Locked' : 'Lock';
  $<HTMLInputElement>('#d-auto').checked = !!s?.config.autoTower;
  const marks = s?.config.marks !== false;
  $<HTMLInputElement>('#d-markbox').checked = marks;
  const mb = $('#d-marks');
  mb.classList.toggle('off', !marks);
  mb.setAttribute('aria-pressed', String(marks));
  mb.textContent = marks ? '◉' : '○';
  const op = Math.round((s?.config.opacity ?? 1) * 100);
  const range = $<HTMLInputElement>('#d-op');
  if (document.activeElement !== range) range.value = String(op);
  $('#d-opv').textContent = op + '%';
}

/** what the game shows, in one line: day, lives, gold, level, luck, next chest */
function paintRun(): void {
  const h = hud;
  const chip = (label: string, v: string | undefined, cls = '') =>
    '<span class="d-chip ' + cls + '"><small>' + label + '</small><b>' + esc(v ?? '–') + '</b></span>';
  put(
    $('#d-run'),
    chip('Day', (h.day ?? plan.day).toString()) +
      chip('Lives', h.lives ? h.lives.join('/') : undefined, 'lives') +
      chip('Gold', h.gold?.toString(), 'gold') +
      chip('Level', h.level !== undefined ? h.level + (h.xp ? ' · ' + h.xp[0] + '/' + h.xp[1] : '') : undefined) +
      chip('Luck', h.luck !== undefined ? h.luck + '%' : undefined) +
      chip('Chest', h.chest, 'r-' + (h.chest ?? '')),
  );
}

const MOVE_ICON: Record<Move['kind'], string> = {
  take: '✔',
  move: '↔',
  buy: '🛒',
  star: '★',
  merge: '⇪',
  swap: '⇄',
  sell: '💰',
  roll: '⟳',
  level: '⬆',
  save: '⏸',
  wait: '⏳',
};
/** the path's tower, cell by cell: green = right place, orange = you have it elsewhere (move it), faded = still missing */
function towerPlan(): string {
  const tower = plan.cells.map((c) => c?.id ?? null);
  const { target, moves } = placement(path, tower);
  if (!target.some(Boolean)) return '';
  return (
    '<small class="d-plan-h">Tower plan · where each item goes</small><div class="d-plan" aria-label="Where the items go">' +
    target
      .map((id, i) => {
        if (!id) return '<span class="d-pc empty" title="' + CELL_NAMES[i] + '"></span>';
        const state = tower[i] === id ? 'ok' : moves.some((m) => m.id === id && m.to === i) ? 'move' : 'need';
        return '<span class="d-pc ' + state + '" title="' + esc(nameOf(id) + ' · ' + CELL_NAMES[i]) + '">' + pic(id) + '</span>';
      })
      .join('') +
    '</div>'
  );
}
const pickBest = (p: { ids: (string | null)[] }) => judgePick(p.ids, [...owned().map((c) => c.id), ...bench], path, allPaths);
function paintCoach(): void {
  const moves = decide({
    tower: plan.cells.map((c) => c?.id ?? null),
    bench,
    verdicts,
    path,
    hud,
    day: plan.day,
    shopOpen: shop.some(Boolean),
    pick: pick && pickBest(pick) ? { id: pick.ids[pickBest(pick)!.best]!, why: pickBest(pick)!.why } : null,
    encounter: encounter ? { option: encounter.options[encounter.pick] ?? '', text: encounter.text, why: encounter.why } : null,
  });
  const [now, ...then] = moves;
  put(
    $('#d-move'),
    now
      ? '<div class="d-now k-' +
          now.kind +
          '"><span class="d-ico">' +
          MOVE_ICON[now.kind] +
          '</span><span class="d-what"><b>' +
          esc(now.title) +
          '</b><small>' +
          esc(now.detail) +
          '</small></span>' +
          (now.items.length ? '<span class="d-pics">' + now.items.map((id) => pic(id)).join('') + '</span>' : '') +
          '</div>' +
          '<ol class="d-then">' +
          then
            .slice(0, 2)
            .map((m) => '<li><span>' + MOVE_ICON[m.kind] + '</span>Then: <b>' + esc(m.title) + '</b></li>')
            .join('') +
          '</ol>'
      : '',
  );

  // the shop: what matters first, the rest folded into one line
  const list = verdicts.filter((v): v is Verdict => !!v);
  const keep = list.filter((v) => v.tone !== 'skip');
  const skip = list.length - keep.length;
  put(
    $('#d-shop'),
    list.length
      ? '<h4>Shop</h4><ul>' +
          keep
            .map(
              (v) =>
                '<li class="t-' +
                v.tone +
                '">' +
                pic(v.id) +
                '<span><b>' +
                esc(nameOf(v.id)) +
                '</b><small>' +
                esc(v.why) +
                '</small></span><em>' +
                esc(v.badge) +
                '</em></li>',
            )
            .join('') +
          '</ul>' +
          (skip ? '<p class="d-skip">' + skip + ' other' + (skip > 1 ? 's' : '') + ': skip</p>' : '') +
          (bench.length ? '<p class="d-bench"><small>Bench</small>' + bench.map((id) => pic(id)).join('') + '</p>' : '')
      : '<h4>Shop</h4><p class="d-skip">Closed. Open a shop in the game.</p>',
  );

  // your path, the others folded away
  const others = allPaths.filter((p) => p !== path);
  put(
    $('#d-path'),
    path
      ? '<h4>Your path</h4><div class="d-cur"><b>' +
          esc(pathName(path.b)) +
          '</b><small>' +
          Math.round(path.done * 100) +
          '% done' +
          (path.missing.length ? ' · needs' : '') +
          '</small>' +
          (path.missing.length
            ? '<span class="d-need">' +
              path.missing
                .slice(0, 6)
                .map((id) => pic(id))
                .join('') +
              '</span>'
            : '') +
          '</div>' +
          towerPlan() +
          (others.length
            ? '<details class="d-others"><summary>Other paths (' +
              others.length +
              ')</summary>' +
              others
                .map(
                  (p) =>
                    '<button type="button" class="d-path" data-path="' +
                    esc(p.b.id) +
                    '"><b>' +
                    esc(pathName(p.b)) +
                    '</b><small>' +
                    Math.round(p.done * 100) +
                    '% done · follow this</small></button>',
                )
                .join('') +
              '</details>'
            : '')
      : '<h4>Your path</h4><p class="d-skip">Add items (or let the coach read your tower) to see your path.</p>',
  );
}

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
    '<button type="button" class="d-x d-marks" id="d-marks" title="Marks on the game on / off (Ctrl+Shift+M)" aria-pressed="true">◉</button>' +
    '<button type="button" class="d-x" id="d-hide" title="Hide (Ctrl+Shift+O)">–</button><button type="button" class="d-x" id="d-quit" title="Quit">×</button></header>' +
    '<div class="d-run" id="d-run"></div>' +
    '<section class="d-move" id="d-move"></section>' +
    '<section class="d-shop" id="d-shop"></section>' +
    '<section class="d-pathbox" id="d-path"></section>' +
    '<details class="d-fold" id="d-more"><summary>Tower &amp; planner</summary><div class="d-perk">' +
    perkSelect() +
    '<button type="button" class="ov-btn" id="d-clear">Clear tower</button></div><div id="d-ov"></div></details>' +
    '<details class="d-fold"><summary>Settings</summary><div class="d-tools"><button type="button" class="ov-btn" id="d-cal" title="Ctrl+Shift+K">Calibrate</button><button type="button" class="ov-btn" id="d-scan" title="Ctrl+Shift+S">Scan</button><button type="button" class="ov-btn" id="d-lock" title="Click-through; Ctrl+Shift+L unlocks">Lock</button>' +
    '<button type="button" class="ov-btn" id="d-snap" title="Saves the screen, the cut-outs and what the coach read (on this PC) – send it to the developer when something is read wrong">Save snapshot</button>' +
    '<label class="d-auto" title="Frames and labels on the game (Ctrl+Shift+M)"><input type="checkbox" id="d-markbox"> marks on the game</label>' +
    '<label class="d-auto" title="Take over your tower, perk, day, gold and level from the game"><input type="checkbox" id="d-auto"> auto read</label>' +
    '<label class="d-op" title="See-through: Ctrl+Shift+Up / Down"><span>◐</span><input type="range" id="d-op" min="20" max="100" step="5" aria-label="Panel opacity"><b id="d-opv"></b></label></div></details>' +
    (api ? '' : '<p class="d-note">Open this page in the Oaken Tower Overlay app to read the game.</p>');

  refreshOverlay = mountOverlay($('#d-ov'), view, {
    day(d) {
      plan.day = Math.max(1, Math.min(16, plan.day + d));
      afterChange();
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
      afterChange();
    },
    star(i, d) {
      const c = plan.cells[i];
      if (!c) return;
      const n = Math.max(0, Math.min(3, c.star + d));
      if (n === c.star) return;
      c.star = n;
      afterChange();
    },
  });

  $('#d-path').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-path]');
    if (!b) return;
    picked = b.dataset.path!;
    try {
      localStorage.setItem(PATH_KEY, picked);
    } catch {
      /* this session only */
    }
    coach();
    refresh();
  });
  $('#d-perk').addEventListener('change', (e) => {
    plan.perk = (e.target as HTMLSelectElement).value;
    afterChange();
  });
  $('#d-clear').addEventListener('click', () => {
    plan.cells = new Array(CELLS).fill(null);
    calmTower.reset();
    afterChange();
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
  $('#d-markbox').addEventListener('change', (e) => void api?.set({ marks: (e.target as HTMLInputElement).checked }));
  $('#d-marks').addEventListener('click', () => void api?.set({ marks: state?.config.marks === false }));
  $('#d-snap').addEventListener('click', () => void saveSnapshot());
  $('#d-hide').addEventListener('click', () => api?.hide());
  $('#d-quit').addEventListener('click', () => api?.quit());

  if (api) {
    api.onState((s) => {
      const recal =
        JSON.stringify([s.config.shop, s.config.tower]) !== JSON.stringify([state?.config.shop, state?.config.tower]) ||
        JSON.stringify(s.display) !== JSON.stringify(state?.display);
      const marksChanged = (state?.config.marks !== false) !== (s.config.marks !== false);
      const paused = state?.config.scan && !s.config.scan;
      state = s;
      if (recal) {
        calmShop.reset();
        calmTower.reset();
        calmBench.reset();
        shop = [];
        bench = [];
        coach();
      }
      if (recal || paused) stopStream();
      if (marksChanged) coach();
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
    window.setInterval(() => void scan(), 300);
  }
  coach();
  paintRun();
  if (owned().length) void compute();
}

init();
