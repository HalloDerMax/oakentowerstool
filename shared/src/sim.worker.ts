/* Runs simulations and the optimizer off the main thread so the UI never blocks. */
import { simulateAuto } from './core/engine';
import { autofill, suggest, type OptimizeOptions } from './core/optimize';
import type { Build, SimOptions } from './core/types';
import { buildsForPacks } from './core/growth';

export type SimRequest =
  | { id: number; op: 'many'; build: Build; opts: SimOptions; runs: number }
  | { id: number; op: 'suggest'; build: Build; opts: OptimizeOptions }
  | { id: number; op: 'autofill'; build: Build; opts: OptimizeOptions }
  | { id: number; op: 'grow'; packs: string[]; perk: string | null };

export type SimResponse =
  | { id: number; type: 'progress'; done: number; runs: number }
  | { id: number; type: 'done'; result: unknown }
  | { id: number; type: 'error'; message: string };

const post = (m: SimResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const req = e.data;
  const id = req.id;
  let last = 0;
  const progress = (done: number, total: number) => {
    const now = Date.now();
    if (now - last > 80 || done === total) {
      last = now;
      post({ id, type: 'progress', done, runs: total });
    }
  };
  try {
    const result =
      req.op === 'many'
        ? simulateAuto(req.build, req.opts, req.runs, progress)
        : req.op === 'suggest'
          ? suggest(req.build, req.opts, progress)
          : req.op === 'grow'
            ? buildsForPacks(req.packs, req.perk, progress)
            : autofill(req.build, req.opts, progress);
    post({ id, type: 'done', result });
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
