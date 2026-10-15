import type { LinkPlan } from '../shared/src/core/planlink';

/* Types of the bridge the app's preload script puts on window.oakenDesktop (see desktop/preload.cjs). */
/** fractions of the game display (0..1) */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type ShopRow = Rect & { n: number };
export interface DesktopConfig {
  /** one box per shop row (the rows of the shop are offset against each other) */
  shop?: ShopRow[];
  tower?: Rect & { cols: number; rows: number };
  scan?: boolean;
  autoTower?: boolean;
  /** panel opacity 0.2–1 */
  opacity?: number;
}
export interface DesktopState {
  config: DesktopConfig;
  locked: boolean;
  visible: boolean;
  calibrating: boolean;
  /** the game display in screen pixels */
  display: { x: number; y: number; width: number; height: number };
}
export interface Capture {
  w: number;
  h: number;
  bgra?: boolean;
  data: Uint8Array;
}
/** one badge above a shop item */
export interface HintSlot {
  id: string;
  name: string;
  /** buy: your build needs it · star: copy of one you have · alt: fits another path · skip */
  tone: 'buy' | 'star' | 'fit' | 'alt' | 'skip';
  /** short label on the item */
  badge: string;
  /** one line why */
  why: string;
  rect: Rect;
}
export interface DesktopApi {
  capture(): Promise<{ shop: Capture[]; tower: Capture | null } | null>;
  state(): Promise<DesktopState>;
  set(patch: Partial<DesktopConfig>): Promise<DesktopState>;
  onState(fn: (s: DesktopState) => void): void;
  sendHints(d: { slots: (HintSlot | null)[] }): void;
  onHints(fn: (d: { slots: (HintSlot | null)[] }) => void): void;
  /** the shared plan (the website planner sees the same one when linked) */
  getPlan(): Promise<LinkPlan | null>;
  setPlan(p: LinkPlan): void;
  onPlan(fn: (m: { client: string; plan: LinkPlan }) => void): void;
  calibrate(): void;
  calibrated(): void;
  lock(on: boolean): void;
  hide(): void;
  quit(): void;
  snapshot(d: { files: Record<string, string>; info: unknown }): Promise<string>;
}
