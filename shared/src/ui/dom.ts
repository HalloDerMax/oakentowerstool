/* Tiny DOM helpers shared by the UI modules. */

export function $<T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error('missing element ' + sel);
  return el;
}

export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T[] =>
  Array.from(root.querySelectorAll<T>(sel));

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape text for use inside HTML templates (content and attribute values). */
export const esc = (s: unknown): string => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]!);

/** Closest ancestor (inclusive) matching sel, typed. Works when the event target is a text node. */
export const closest = <T extends HTMLElement = HTMLElement>(t: EventTarget | null, sel: string): T | null =>
  t instanceof Element ? (t.closest(sel) as T | null) : null;

let toastTimer = 0;
export function toast(msg: string): void {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('on'), 2400);
}

export const isTyping = (): boolean => {
  const a = document.activeElement;
  return !!a && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || (a as HTMLElement).isContentEditable);
};

export const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
