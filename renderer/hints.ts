/* Hints layer: a transparent, click-through window over the game display.
 *   normal:      a label on every shop item: BUY · <build>, STAR ↑, Switch · <build>, Skip
 *   calibrating: one box per shop row and one around your tower; saved as fractions of the display
 */
import '../shared/src/styles/tokens.css';
import './desktop.css';

import { esc } from '../shared/src/ui/dom';
import type { DesktopApi, DesktopState, HintSlot, Rect, ShopRow } from './bridge';

const api = (window as unknown as { oakenDesktop?: DesktopApi }).oakenDesktop;
const root = document.createElement('div');
root.id = 'h-root';
document.body.className = 'h-body';
document.body.appendChild(root);

let state: DesktopState | null = null;
let slots: (HintSlot | null)[] = [];

const pct = (n: number) => (n * 100).toFixed(3) + '%';
const place = (r: Rect) => 'left:' + pct(r.x) + ';top:' + pct(r.y) + ';width:' + pct(r.w) + ';height:' + pct(r.h);

/* Badges: one calm label per shop place. A label is only touched when its text changes; a new one fades in
 * once, the rest stay still. */
const badgeLayer = document.createElement('div');
badgeLayer.id = 'h-badges';
document.body.appendChild(badgeLayer);
const shownKey: string[] = [];
function paintBadges(): void {
  const cal = !!state?.calibrating;
  badgeLayer.hidden = cal;
  const n = Math.max(slots.length, badgeLayer.children.length);
  for (let i = 0; i < n; i++) {
    const s = slots[i] ?? null;
    const key = s ? s.tone + '|' + s.badge + '|' + place(s.rect) : '';
    let el = badgeLayer.children[i] as HTMLElement | undefined;
    if (!el) {
      el = document.createElement('div');
      badgeLayer.appendChild(el);
    }
    if (shownKey[i] === key) continue;
    shownKey[i] = key;
    if (!s) {
      el.className = 'h-slot gone';
      continue;
    }
    el.className = 'h-slot t-' + s.tone;
    el.setAttribute('style', place(s.rect));
    el.innerHTML = '<span class="h-badge">' + esc(s.badge) + '</span>';
  }
}

/* ---------- calibration ---------- */
type Step = 'shop' | 'tower' | 'done';
let step: Step = 'shop';
/** one box per shop row: the rows of the shop are offset against each other */
let shopRows: ShopRow[] = [];
let towerBox: (Rect & { cols: number; rows: number }) | null = null;
let drag: { x0: number; y0: number; x1: number; y1: number } | null = null;

function grid(r: Rect, cols: number, rows: number, cls: string, label = ''): string {
  let lines = '';
  for (let c = 1; c < cols; c++) lines += '<i class="h-v" style="left:' + (c / cols) * 100 + '%"></i>';
  for (let w = 1; w < rows; w++) lines += '<i class="h-h" style="top:' + (w / rows) * 100 + '%"></i>';
  return (
    '<div class="h-box ' +
    cls +
    '" style="' +
    place(r) +
    '">' +
    (label ? '<span class="h-tag">' + label + '</span>' : '') +
    lines +
    '</div>'
  );
}

function rowsHtml(): string {
  return shopRows
    .map(
      (r, i) =>
        '<label>Row ' +
        (i + 1) +
        ': places <input type="number" data-row="' +
        i +
        '" id="h-n-' +
        i +
        '" min="1" max="12" value="' +
        r.n +
        '"></label><button type="button" class="x" data-h="del:' +
        i +
        '" title="Remove this row">×</button>',
    )
    .join('');
}

function calibrationHtml(): string {
  const live = drag ? norm(drag) : null;
  const help =
    step === 'shop'
      ? '<b>1 / 2 · Shop</b> Open a shop in the game. Drag <u>one box per shop row</u> around the item pictures, empty places included. Then set how many places each row has: the lines must split the items.'
      : step === 'tower'
        ? '<b>2 / 2 · Your tower</b> Drag a box around the item cells of your tower. Or skip it.'
        : '<b>Done?</b> Check the boxes: every item should sit in its own cell.';
  return (
    '<div class="h-cal">' +
    shopRows.map((r, i) => grid(r, r.n, 1, 'shop', 'Shop row ' + (i + 1))).join('') +
    (towerBox ? grid(towerBox, towerBox.cols, towerBox.rows, 'tower', 'Tower') : '') +
    (live ? '<div class="h-box live" style="' + place(live) + '"></div>' : '') +
    '<div class="h-help"><p>' +
    help +
    '</p>' +
    (shopRows.length ? '<div class="h-row">' + rowsHtml() + '</div>' : '') +
    (towerBox
      ? '<div class="h-row"><label>Tower columns <input type="number" id="h-cols" min="1" max="6" value="' +
        towerBox.cols +
        '"></label><label>rows <input type="number" id="h-rows" min="1" max="8" value="' +
        towerBox.rows +
        '"></label></div>'
      : '') +
    '<div class="h-row">' +
    (step === 'shop' && shopRows.length ? '<button type="button" class="pri" data-h="next">Next: tower ›</button>' : '') +
    (step === 'tower' ? '<button type="button" data-h="skip">Skip tower</button><button type="button" data-h="back">‹ Back</button>' : '') +
    (step === 'done' ? '<button type="button" class="pri" data-h="save">Save</button>' : '') +
    (step !== 'shop' || shopRows.length ? '<button type="button" data-h="redo">Start again</button>' : '') +
    '<button type="button" data-h="cancel">Cancel</button></div>' +
    '<small>Esc cancels · Ctrl+Shift+K also closes this</small></div></div>'
  );
}

function norm(d: { x0: number; y0: number; x1: number; y1: number }): Rect {
  const W = window.innerWidth,
    H = window.innerHeight;
  return { x: Math.min(d.x0, d.x1) / W, y: Math.min(d.y0, d.y1) / H, w: Math.abs(d.x1 - d.x0) / W, h: Math.abs(d.y1 - d.y0) / H };
}

function render(): void {
  const cal = !!state?.calibrating;
  document.body.classList.toggle('cal', cal);
  root.innerHTML = cal ? calibrationHtml() : '';
  paintBadges();
}

function startCal(): void {
  shopRows = (state?.config.shop ?? []).map((r) => ({ ...r }));
  towerBox = state?.config.tower ? { ...state.config.tower } : null;
  step = shopRows.length ? 'done' : 'shop';
}

root.addEventListener('pointerdown', (e) => {
  if (!state?.calibrating || step === 'done' || (e.target as HTMLElement).closest('.h-help')) return;
  drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
  root.setPointerCapture(e.pointerId);
});
root.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.x1 = e.clientX;
  drag.y1 = e.clientY;
  render();
});
root.addEventListener('pointerup', () => {
  if (!drag) return;
  const r = norm(drag);
  drag = null;
  if (r.w * window.innerWidth < 20 || r.h * window.innerHeight < 20) return render();
  if (step === 'shop') {
    // first guess of the places from the box shape (a shop place is about 1.45 times as wide as high)
    const n = Math.max(1, Math.min(12, Math.round((r.w * window.innerWidth) / (r.h * window.innerHeight * 1.45))));
    shopRows.push({ ...r, n });
  } else if (step === 'tower') {
    towerBox = { ...r, cols: 2, rows: 3 };
    step = 'done';
  }
  render();
});
root.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  const v = Math.max(1, Number(t.value) || 1);
  const row = t.dataset.row ? shopRows[Number(t.dataset.row)] : undefined;
  if (row) row.n = Math.min(12, v);
  if (t.id === 'h-cols' && towerBox) towerBox.cols = Math.min(6, v);
  if (t.id === 'h-rows' && towerBox) towerBox.rows = Math.min(8, v);
  const keep = t.id;
  render();
  const again = document.getElementById(keep) as HTMLInputElement | null;
  again?.focus();
  again?.select();
});
root.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-h]');
  if (!b) return;
  const k = b.dataset.h!;
  if (k === 'next') step = 'tower';
  else if (k === 'back') step = 'shop';
  else if (k === 'skip') {
    towerBox = null;
    step = 'done';
  } else if (k.startsWith('del:')) {
    shopRows.splice(Number(k.slice(4)), 1);
    if (!shopRows.length) step = 'shop';
  } else if (k === 'redo') {
    shopRows = [];
    towerBox = null;
    step = 'shop';
  } else if (k === 'save') {
    void api?.set({ shop: shopRows, tower: towerBox ?? undefined }).then(() => api.calibrated());
    return;
  } else if (k === 'cancel') return api?.calibrated();
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state?.calibrating) api?.calibrated();
});

if (api) {
  api.onState((s) => {
    const begin = s.calibrating && !state?.calibrating;
    state = s;
    if (begin) startCal();
    render();
  });
  api.onHints((d) => {
    slots = d.slots;
    paintBadges();
  });
  void api.state().then((s) => {
    state = s;
    render();
  });
}
