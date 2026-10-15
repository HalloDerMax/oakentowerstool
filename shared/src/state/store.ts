/* Build state: the single source of truth for the builder.
 * Every change goes through mutate() so undo, persistence and re-rendering stay in sync.
 * DOM-free (storage is injected) so it can be unit-tested.
 */
import { ITEM_BY_ID } from '../data/items';
import { PERKS } from '../data/perks';
import { POTION_BY_ID } from '../data/potions';
import { SLOT_BY_ID } from '../data/slots';
import type { BuildState, OpponentState, PotionTarget, TowerState } from '../core/types';

export const ROWS = 3;
export const COLS = 2;
export const CELLS = ROWS * COLS;
export const MAX_PERKS = 4;
export const DAY_RANGE: [number, number] = [1, 30];
export const LEVEL_RANGE: [number, number] = [1, 11];
const HISTORY = 60;
export const STORAGE_KEY = 'ot-build';

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export const defaultState = (): BuildState => ({
  name: 'My Tower',
  rows: ROWS,
  cols: COLS,
  cells: new Array(CELLS).fill(null),
  slotAt: new Array(CELLS).fill(null),
  perks: [],
  potions: [],
  day: 8,
  level: 5,
});

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

export const defaultOpponent = (): OpponentState => ({
  name: 'Opponent',
  cells: new Array(CELLS).fill(null),
  slotAt: new Array(CELLS).fill(null),
  perks: [],
  potions: [],
  level: 5,
});

/** Validate one tower. strict: unknown items throw; otherwise they become empty cells (e.g. an opponent from old data). */
function validateTower(b: Partial<TowerState>, strict: boolean): TowerState {
  const cells = b.cells!;
  if (cells.length !== CELLS) throw new Error('the tower has exactly 6 slots');
  const outCells = cells.map((c) => {
    if (!c) return null;
    if (typeof c !== 'object' || !ITEM_BY_ID[c.id]) {
      if (strict) throw new Error('unknown item ' + (c && c.id));
      return null;
    }
    return { id: c.id, star: clampInt(c.star, 0, 3, 0) };
  });
  const slotAt =
    Array.isArray(b.slotAt) && b.slotAt.length === CELLS
      ? b.slotAt.map((s) => (s && SLOT_BY_ID[s] ? s : null))
      : new Array(CELLS).fill(null);
  const validTarget = (t: unknown): t is PotionTarget =>
    t === 'deck' || (Number.isInteger(t) && (t as number) >= 0 && (t as number) < CELLS);
  const potions = (Array.isArray(b.potions) ? b.potions : [])
    .filter((p) => p && POTION_BY_ID[p.id] && validTarget(p.t) && p.n > 0)
    .map((p) => ({ id: p.id, t: p.t, n: Math.floor(p.n) }));
  const perks = (Array.isArray(b.perks) ? b.perks : [])
    .filter((p, i, a) => PERKS.some((x) => x.id === p) && a.indexOf(p) === i)
    .slice(0, MAX_PERKS);
  return { cells: outCells, slotAt, perks, potions, level: clampInt(b.level, LEVEL_RANGE[0], LEVEL_RANGE[1], 5) };
}

/** Validate untrusted input (localStorage, share link, import box). Throws with a readable message. */
export function validateState(o: unknown): BuildState {
  if (!o || typeof o !== 'object' || !Array.isArray((o as BuildState).cells)) throw new Error('not a build');
  const b = o as Partial<BuildState>;
  const out: BuildState = {
    name: typeof b.name === 'string' && b.name ? b.name.slice(0, 28) : 'My Tower',
    rows: ROWS,
    cols: COLS,
    ...validateTower(b, true),
    day: clampInt(b.day, DAY_RANGE[0], DAY_RANGE[1], 8),
  };
  const opp = b.opponent;
  if (opp && typeof opp === 'object' && Array.isArray(opp.cells) && opp.cells.length === CELLS) {
    out.opponent = { name: typeof opp.name === 'string' && opp.name ? opp.name.slice(0, 28) : 'Opponent', ...validateTower(opp, false) };
    if (b.vs === true) out.vs = true;
  }
  return out;
}

/** a build (e.g. from a share code) turned into an opponent tower */
export function toOpponent(b: BuildState): OpponentState {
  return { name: b.name, cells: b.cells, slotAt: b.slotAt, perks: b.perks, potions: b.potions, level: b.level };
}

/* ---------- share codes: base64(UTF-8 JSON), compatible with the prototype's #b= links ---------- */
export function encodeBuild(s: BuildState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(s));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
export function decodeBuild(code: string): BuildState {
  const bin = atob(code.trim());
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return validateState(JSON.parse(new TextDecoder().decode(bytes)));
}

/** Keep invariants after any change: fixed size, no potions on empty cells, no slots on empty cells. */
function normalize(s: BuildState): void {
  s.rows = ROWS;
  s.cols = COLS;
  const fix = (t: TowerState) => {
    for (const k of ['cells', 'slotAt'] as const) {
      t[k].length = CELLS;
      for (let i = 0; i < CELLS; i++) if (t[k][i] === undefined) t[k][i] = null;
    }
    t.potions = (t.potions || []).filter((p) => p.t === 'deck' || t.cells[p.t]);
  };
  fix(s);
  if (s.opponent) fix(s.opponent);
}

export type Listener = (s: BuildState) => void;

export function createStore(storage: StorageLike | null = null, initial?: BuildState) {
  let S: BuildState = initial ? validateState(initial) : defaultState();
  const hist: string[] = [];
  const listeners = new Set<Listener>();

  const save = () => {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(S));
    } catch {
      /* quota / private mode */
    }
  };
  const notify = () => listeners.forEach((l) => l(S));

  return {
    get state(): BuildState {
      return S;
    },
    get canUndo(): boolean {
      return hist.length > 0;
    },
    subscribe(l: Listener): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    /** The only way to change the build. fn may edit the draft in place or return a replacement. */
    mutate(fn: (draft: BuildState) => BuildState | void): void {
      hist.push(JSON.stringify(S));
      if (hist.length > HISTORY) hist.shift();
      const next = fn(S);
      if (next) S = next;
      normalize(S);
      save();
      notify();
    },
    undo(): boolean {
      const prev = hist.pop();
      if (prev == null) return false;
      S = JSON.parse(prev);
      save();
      notify();
      return true;
    },
    /** Change without an undo entry (e.g. typing the build name). */
    patchQuiet(fn: (draft: BuildState) => void): void {
      fn(S);
      save();
    },
    /** Load from storage on start-up; invalid data is ignored. */
    loadFromStorage(): boolean {
      if (!storage) return false;
      let raw: string | null;
      try {
        raw = storage.getItem(STORAGE_KEY);
      } catch {
        return false;
      }
      if (!raw) return false;
      try {
        S = validateState(JSON.parse(raw));
        return true;
      } catch {
        return false;
      }
    },
    /** Replace after validation (opening a share link). Undoable, so a link never silently destroys the saved build. */
    replace(s: BuildState): void {
      const next = validateState(s);
      hist.push(JSON.stringify(S));
      if (hist.length > HISTORY) hist.shift();
      S = next;
      save();
      notify();
    },
  };
}

export type Store = ReturnType<typeof createStore>;

/* ---------- pure helpers used by the UI ---------- */

export function addPotion(s: TowerState, id: string, t: PotionTarget): void {
  const ex = s.potions.find((p) => p.id === id && p.t === t);
  if (ex) ex.n++;
  else s.potions.push({ id, t, n: 1 });
}

export function removePotion(s: TowerState, id: string, t: PotionTarget): void {
  const p = s.potions.find((x) => x.id === id && x.t === t);
  if (p && --p.n <= 0) s.potions.splice(s.potions.indexOf(p), 1);
}

/** Swap two tower cells including their slots and potions. */
export function swapCells(s: TowerState, i: number, j: number): void {
  if (i === j) return;
  [s.cells[i], s.cells[j]] = [s.cells[j]!, s.cells[i]!];
  [s.slotAt[i], s.slotAt[j]] = [s.slotAt[j]!, s.slotAt[i]!];
  s.potions.forEach((p) => {
    if (p.t === i) p.t = j;
    else if (p.t === j) p.t = i;
  });
}

export function clearCell(s: TowerState, i: number): void {
  s.cells[i] = null;
  s.slotAt[i] = null;
}

export const firstFree = (s: TowerState): number => s.cells.findIndex((c) => !c);
