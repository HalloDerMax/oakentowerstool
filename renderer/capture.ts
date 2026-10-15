/* Screen reading without stutter: one quiet video stream of the game display (2 frames a second) instead of a
 * full screenshot each time. Only the boxes we need are drawn out of the current frame.
 * The app answers the stream request itself (no picker) with the display the game is on, at its full resolution
 * (sharp digits for gold, day and level).
 */
import type { Rect } from './bridge';
import type { Img } from './recognize';

let video: HTMLVideoElement | null = null;
let starting: Promise<HTMLVideoElement> | null = null;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

function start(): Promise<HTMLVideoElement> {
  starting ??= (async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 6, max: 10 }, width: { ideal: 7680 }, height: { ideal: 4320 } },
      audio: false,
    });
    const v = document.createElement('video');
    v.muted = true;
    v.srcObject = stream;
    await v.play();
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stop());
    video = v;
    return v;
  })().catch((e: unknown) => {
    starting = null;
    throw e;
  });
  return starting;
}

/** end the stream (scan paused, display changed) */
export function stop(): void {
  const s = video?.srcObject as MediaStream | null | undefined;
  s?.getTracks().forEach((t) => t.stop());
  video = null;
  starting = null;
}

/** cut boxes (fractions of the display) out of the current frame */
export async function grab(rects: Rect[]): Promise<Img[]> {
  const v = await start();
  const W = v.videoWidth,
    H = v.videoHeight;
  if (!W || !H) return [];
  return rects.map((r) => {
    const x = Math.max(0, Math.round(r.x * W)),
      y = Math.max(0, Math.round(r.y * H));
    const w = Math.max(1, Math.min(W - x, Math.round(r.w * W))),
      h = Math.max(1, Math.min(H - y, Math.round(r.h * H)));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(v, x, y, w, h, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    return { w, h, data: d.data };
  });
}
