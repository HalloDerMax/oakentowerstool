/* Icons: local public/img/<slug>.png first.
 * Until the artwork rights are cleared and scripts/fetch-icons.ts has filled public/img, remote fallbacks
 * (oaken.gg sprite, wiki image) can be enabled with VITE_ICON_REMOTE=true. Default: off (no hotlinking).
 * The last fallback is a letter badge.
 */
import { slug } from '../data/slug';
import { esc } from './dom';

const REMOTE = import.meta.env.VITE_ICON_REMOTE === 'true';
const WIKI = 'https://oakentower.wiki.gg/images/';
const SPRITE = 'https://www.oaken.gg/sprites/spr_';

export const camel = (n: string): string =>
  String(n)
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(/\s+/)
    .map((w, i) => (i ? w.charAt(0).toUpperCase() + w.slice(1) : w.charAt(0).toLowerCase() + w.slice(1)))
    .join('');

/** Remote candidates for a name (also used by scripts/fetch-icons.ts). */
export const remoteIconUrls = (name: string): string[] => [
  SPRITE + camel(name) + '.png',
  WIKI + encodeURIComponent(name.replace(/ /g, '_')).replace(/%27/g, "'") + '.png',
];

const base = import.meta.env.BASE_URL;

export function icon(name: string, cls = ''): string {
  const alts = REMOTE ? remoteIconUrls(name) : [];
  return (
    '<img class="ico ' +
    cls +
    '" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="" data-m="' +
    esc(name.charAt(0)) +
    '" data-alts="' +
    esc(alts.join('|')) +
    '" src="' +
    base +
    'img/' +
    slug(name) +
    '.png">'
  );
}

/** One capture listener handles all broken icons: try the next source, then show a letter badge. */
export function installIconFallback(): void {
  document.addEventListener(
    'error',
    (e) => {
      const t = e.target;
      if (!(t instanceof HTMLImageElement) || !t.classList.contains('ico')) return;
      const alts = (t.dataset.alts || '').split('|').filter(Boolean);
      if (alts.length) {
        t.dataset.alts = alts.slice(1).join('|');
        t.src = alts[0]!;
        return;
      }
      const m = document.createElement('span');
      m.className = t.className + ' mono';
      m.setAttribute('aria-hidden', 'true');
      m.textContent = t.dataset.m || '?';
      t.replaceWith(m);
    },
    true,
  );
}

/** item icon that opens the same hover card as in the builder (see tooltip.ts) */
export const itemIcon = (id: string, name: string, star = 0, cls = ''): string =>
  icon(name, cls).replace('<img ', '<img data-tt-item="' + esc(id) + '" data-tt-star="' + star + '" ');
/** perk icon with the perk hover card */
export const perkIcon = (id: string, name: string, cls = ''): string =>
  icon(name, cls).replace('<img ', '<img data-tt-perk="' + esc(id) + '" ');
