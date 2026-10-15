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

  /** feed one reading per place; returns the calm result */
  push(read: (string | null)[]): (string | null)[] {
    read.forEach((id, i) => {
      const s = (this.seen[i] ??= { id: null, n: 0 });
      if (s.id === id) s.n++;
      else this.seen[i] = { id, n: 1 };
      const now = this.seen[i]!;
      const cur = this.shown[i] ?? null;
      if (now.id === cur) return;
      if (now.id === null ? now.n >= this.clear : now.n >= this.confirm) this.shown[i] = now.id;
    });
    this.shown.length = read.length;
    return Array.from(this.shown, (x) => x ?? null);
  }

  reset(): void {
    this.shown = [];
    this.seen = [];
  }
}
