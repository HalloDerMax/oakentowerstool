/* Slot artwork: animated frame sprite sheets (public/img/slots/<id>.png, 140×140 per frame, frames side by side).
 * The game draws them around a tower cell that has a slot; we do the same. Accent colours for small badges.
 */
import { esc } from './dom';

/** frames per sheet (sheet width / 140) and accent colour per slot id */
export const SLOT_ART: Record<string, { frames: number; accent: string }> = {
  artillery: { frames: 13, accent: '#9c7a55' },
  bleed: { frames: 15, accent: '#e0445a' },
  burn: { frames: 10, accent: '#ff8c3a' },
  crit: { frames: 13, accent: '#f3ad34' },
  damage: { frames: 15, accent: '#ef6a4f' },
  heal: { frames: 15, accent: '#5fb36a' },
  hex: { frames: 14, accent: '#b0476b' },
  magic: { frames: 15, accent: '#b15cff' },
  melee: { frames: 15, accent: '#d98c4a' },
  midas: { frames: 28, accent: '#f3ad34' },
  multicast: { frames: 15, accent: '#b274d8' },
  night: { frames: 13, accent: '#6b6bff' },
  pandora: { frames: 23, accent: '#b15cff' },
  poison: { frames: 16, accent: '#7bbf3a' },
  shield: { frames: 15, accent: '#56a6e6' },
  shock: { frames: 15, accent: '#4ec0ff' },
  time: { frames: 23, accent: '#8b9bd8' },
  vitality: { frames: 15, accent: '#e06aa0' },
  wild: { frames: 28, accent: '#2ed3bd' },
};

const FPS = 12;

export const slotAccent = (id: string): string => SLOT_ART[id]?.accent || 'var(--brass)';

/** Inline style for an element that plays the slot's frame animation as its background. */
export function slotArtStyle(id: string): string {
  const a = SLOT_ART[id];
  if (!a) return '';
  return (
    '--sheet:url(' +
    import.meta.env.BASE_URL +
    'img/slots/' +
    esc(id) +
    '.png);--frames:' +
    a.frames +
    ';--dur:' +
    (a.frames / FPS).toFixed(2) +
    's;--accent:' +
    a.accent
  );
}

/** Square animated slot frame (codex rows, perk picker). */
export const slotArt = (id: string, cls = ''): string =>
  SLOT_ART[id] ? '<span class="slotart ' + cls + '" style="' + slotArtStyle(id) + '" aria-hidden="true"></span>' : '';
