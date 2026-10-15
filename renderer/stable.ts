/* Calm readings: a place only changes when the screen agrees a few times in a row.
 * Flames, sparkles and the mouse make single frames unreliable; this stops the badges from jumping around.
 */
export class Stable {
  private shown: (string | null)[] = [];
  private seen: { id: string | null; n: number }[] = [];
  /**
   * @param confirm   same new item this many times in a row → shown
   * @param clear     nothing this many times in a row → empty
   */
  constructor(
    private confirm = 2,
    private clear = 3,
  ) {}

  /** feed one reading per place; returns the calm result. `sure`: a clear match is shown at once */
  push(read: (string | null)[], sure: boolean[] = []): (string | null)[] {
    read.forEach((id, i) => {
      const s = (this.seen[i] ??= { id: null, n: 0 });
      if (s.id === id) s.n++;
      else this.seen[i] = { id, n: 1 };
      const now = this.seen[i]!;
      const cur = this.shown[i] ?? null;
      if (now.id === cur) return;
      if (now.id === null ? now.n >= this.clear : now.n >= this.confirm || sure[i]) this.shown[i] = now.id;
      // another item is coming: the old label goes at once (a wrong label is worse than none)
      else if (now.id !== null && cur !== null) this.shown[i] = null;
    });
    this.shown.length = read.length;
    return Array.from(this.shown, (x) => x ?? null);
  }

  /** what push would show, without counting this reading (for an early look) */
  peek(read: (string | null)[], sure: boolean[] = []): (string | null)[] {
    return read.map((id, i) => {
      const cur = this.shown[i] ?? null;
      if (id && id !== cur && sure[i]) return id;
      return cur;
    });
  }

  /** a change is seen but not confirmed yet (look again soon) */
  pending(): boolean {
    return this.seen.some((s, i) => s && s.id !== (this.shown[i] ?? null));
  }

  reset(): void {
    this.shown = [];
    this.seen = [];
  }
}
