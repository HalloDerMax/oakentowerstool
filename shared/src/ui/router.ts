/* Hash routing: #/builder, #/items, #/items/<itemId>, #/perks …
 * Share links: #/builder?b=<code>. Legacy prototype links (#b=<code>) are still accepted.
 * Hash routing needs no SPA fallback on the server (static hosting is enough).
 */
export const PAGES = [
  'builder',
  'planner',
  'builds',
  'community',
  'endless',
  'codex',
  'items',
  'perks',
  'slots',
  'packs',
  'potions',
  'encounters',
  'mechanics',
] as const;
export type Page = (typeof PAGES)[number];

export interface Route {
  page: Page;
  /** e.g. item id for #/items/chopper */
  sub: string | null;
  /** share code from ?b= or legacy #b= */
  build: string | null;
  /** build code to fight as the opponent (?o=) */
  opp?: string;
}

const isPage = (p: string): p is Page => (PAGES as readonly string[]).includes(p);

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '');
  if (h.startsWith('b=')) return { page: 'builder', sub: null, build: decodeURIComponent(h.slice(2)) };
  const [path = '', query = ''] = h.split('?');
  const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);
  // old links: #/meta is now #/community
  const first = parts[0] === 'meta' ? 'community' : parts[0];
  const page = first && isPage(first) ? first : 'builder';
  let build: string | null = null;
  let opp: string | undefined;
  for (const kv of query.split('&')) {
    if (kv.startsWith('b=')) build = decodeURIComponent(kv.slice(2));
    if (kv.startsWith('o=')) opp = decodeURIComponent(kv.slice(2));
  }
  const r: Route = { page, sub: parts[1] ? decodeURIComponent(parts[1]) : null, build };
  if (opp) r.opp = opp;
  return r;
}

/** link that opens the builder with this build as the opponent */
export const opponentHref = (code: string): string => '#/builder?o=' + encodeURIComponent(code);

export const pageHref = (page: Page, sub?: string): string => '#/' + page + (sub ? '/' + encodeURIComponent(sub) : '');
export const shareHref = (code: string): string => '#/builder?b=' + encodeURIComponent(code);

export function onRoute(fn: (r: Route) => void): void {
  window.addEventListener('hashchange', () => fn(parseHash(location.hash)));
  fn(parseHash(location.hash));
}

/** Change the URL without adding a history entry or firing hashchange. */
export function replaceHash(href: string): void {
  history.replaceState(null, '', href);
}
