/* Text reader for the HUD (Tesseract, offline: its files ship with the app under ocr/). */
import { createWorker, OEM, PSM, type Worker as OcrWorker } from 'tesseract.js';
import { HUD_FIELDS, inkOnPaper, readable, type HudKey, type InkMode } from './hud';
import { resize, type Img } from './recognize';

let worker: Promise<OcrWorker> | null = null;
const base = () => new URL('ocr/', location.href).href;
function getWorker(): Promise<OcrWorker> {
  worker ??= createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: base() + 'worker.min.js',
    corePath: base(),
    langPath: base(),
    gzip: true,
    workerBlobURL: false,
    cacheMethod: 'none',
  });
  return worker;
}

/** last text per field, keyed by a fingerprint of its pixels: unchanged fields are not read again */
const memo = new Map<string, string>();
const canvas = document.createElement('canvas');

/** read the cut-outs of the HUD fields */
export async function readFields(crops: Partial<Record<HudKey, Img>>, fp: (i: Img) => string): Promise<Partial<Record<HudKey, string>>> {
  const out: Partial<Record<HudKey, string>> = {};
  const w = await getWorker();
  for (const f of HUD_FIELDS) {
    const img = crops[f.key];
    if (!img) continue;
    const key = f.key + fp(img);
    const known = memo.get(key);
    if (known !== undefined) {
      out[f.key] = known;
      continue;
    }
    // 3× bigger and black on white: what the reader likes
    const big = resize(img, img.w * 3, img.h * 3);
    await w.setParameters({ tessedit_char_whitelist: f.chars, tessedit_pageseg_mode: PSM.SINGLE_LINE });
    const once = async (ink: InkMode) => {
      canvas.width = big.w;
      canvas.height = big.h;
      canvas.getContext('2d')!.putImageData(new ImageData(inkOnPaper(big, ink) as Uint8ClampedArray<ArrayBuffer>, big.w, big.h), 0, 0);
      const r = await w.recognize(canvas);
      return r.data.confidence >= 60 ? r.data.text.trim() : '';
    };
    let text = await once(f.ink);
    if (f.alt && !readable(f.key, text)) text = await once(f.alt);
    memo.set(key, text);
    out[f.key] = text;
  }
  if (memo.size > 600) memo.clear();
  return out;
}

/** read one line of free text (encounter titles); the picture is scaled to about 40 px text height */
export async function readLine(img: Img, fp: (i: Img) => string): Promise<string> {
  const key = 'line' + fp(img);
  const known = memo.get(key);
  if (known !== undefined) return known;
  const w = await getWorker();
  const k = Math.max(1, Math.min(3, 120 / img.h));
  const big = resize(img, Math.round(img.w * k), Math.round(img.h * k));
  await w.setParameters({
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'!-. ",
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
  });
  canvas.width = big.w;
  canvas.height = big.h;
  canvas.getContext('2d')!.putImageData(new ImageData(inkOnPaper(big, 'light') as Uint8ClampedArray<ArrayBuffer>, big.w, big.h), 0, 0);
  const r = await w.recognize(canvas);
  // the names are matched against the known options afterwards, so an unsure reading is still useful
  const text = r.data.confidence >= 25 ? r.data.text.trim() : '';
  memo.set(key, text);
  return text;
}
