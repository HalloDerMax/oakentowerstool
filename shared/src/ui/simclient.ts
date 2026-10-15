/* Promise wrapper around the simulation worker, with an in-thread fallback (old browsers, worker errors). */
import { simulateAuto } from '../core/engine';
import { autofill, suggest, type OptimizeOptions, type Suggestion } from '../core/optimize';
import { buildsForPacks, type FinishedBuild } from '../core/growth';
import type { Build, ManyResult, SimOptions } from '../core/types';
import type { SimRequest, SimResponse } from '../sim.worker';

type Progress = (done: number, total: number) => void;
type Req = SimRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../sim.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  return worker;
}

/** same work on the main thread */
function local(req: Req, p?: Progress): unknown {
  if (req.op === 'many') return simulateAuto(req.build, req.opts, req.runs, p);
  if (req.op === 'suggest') return suggest(req.build, req.opts, p);
  if (req.op === 'grow') return buildsForPacks(req.packs, req.perk, p);
  return autofill(req.build, req.opts, p);
}

function call<T>(req: Req, onProgress?: Progress): Promise<T> {
  const w = getWorker();
  if (!w) return new Promise((res) => setTimeout(() => res(local(req, onProgress) as T), 30));
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
    };
    const onMsg = (e: MessageEvent<SimResponse>) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'progress') onProgress?.(m.done, m.runs);
      else {
        cleanup();
        if (m.type === 'done') resolve(m.result as T);
        else reject(new Error(m.message));
      }
    };
    const onErr = (e: ErrorEvent) => {
      cleanup();
      worker?.terminate();
      worker = null;
      try {
        resolve(local(req, onProgress) as T); // fall back to the main thread once
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(e.message)));
      }
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage(JSON.parse(JSON.stringify({ ...req, id })) as SimRequest);
  });
}

export const runSimulation = (build: Build, opts: SimOptions, runs: number, onProgress?: Progress): Promise<ManyResult> =>
  call<ManyResult>({ op: 'many', build, opts, runs }, onProgress);

export const runSuggest = (build: Build, opts: OptimizeOptions, onProgress?: Progress): Promise<Suggestion[]> =>
  call<Suggestion[]>({ op: 'suggest', build, opts }, onProgress);

export const runAutofill = (build: Build, opts: OptimizeOptions, onProgress?: Progress): Promise<Build> =>
  call<Build>({ op: 'autofill', build, opts }, onProgress);

/** grow builds for the player's own pack selection (a few seconds) */
export const runGrow = (packs: string[], perk: string | null, onProgress?: Progress): Promise<FinishedBuild[]> =>
  call<FinishedBuild[]>({ op: 'grow', packs, perk }, onProgress);
