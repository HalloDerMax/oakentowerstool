/* Minimal PNG decoder for tests (8-bit RGB/RGBA/palette/grey, not interlaced). */
import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

export function readPng(file: string): { w: number; h: number; data: Uint8ClampedArray } {
  const b = readFileSync(file);
  let p = 8,
    w = 0,
    h = 0,
    depth = 0,
    type = 0,
    plte: Buffer | null = null,
    trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p),
      t = b.toString('ascii', p + 4, p + 8),
      d = b.subarray(p + 8, p + 8 + len);
    if (t === 'IHDR') {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      depth = d[8]!;
      type = d[9]!;
      if (d[12]) throw new Error('interlaced');
    } else if (t === 'PLTE') plte = d;
    else if (t === 'tRNS') trns = d;
    else if (t === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  if (depth !== 8) throw new Error('depth ' + depth);
  const ch = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type]!;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= ch ? px[y * stride + x - ch]! : 0;
      const up = y ? px[(y - 1) * stride + x]! : 0;
      const c = y && x >= ch ? px[(y - 1) * stride + x - ch]! : 0;
      let r = v;
      if (f === 1) r = v + a;
      else if (f === 2) r = v + up;
      else if (f === 3) r = v + ((a + up) >> 1);
      else if (f === 4) {
        const pp = a + up - c,
          pa = Math.abs(pp - a),
          pb = Math.abs(pp - up),
          pc = Math.abs(pp - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
      }
      px[y * stride + x] = r & 255;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * ch;
    if (type === 6) out.set([px[s]!, px[s + 1]!, px[s + 2]!, px[s + 3]!], i * 4);
    else if (type === 2) out.set([px[s]!, px[s + 1]!, px[s + 2]!, 255], i * 4);
    else if (type === 0) out.set([px[s]!, px[s]!, px[s]!, 255], i * 4);
    else if (type === 4) out.set([px[s]!, px[s]!, px[s]!, px[s + 1]!], i * 4);
    else {
      const k = px[s]!;
      out.set([plte![k * 3]!, plte![k * 3 + 1]!, plte![k * 3 + 2]!, trns && k < trns.length ? trns[k]! : 255], i * 4);
    }
  }
  return { w, h, data: out };
}

/** Minimal PNG encoder (RGBA, 8 bit) for tests and tools */
export function encodePng(img: { w: number; h: number; data: Uint8ClampedArray | Uint8Array }): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++)
    Buffer.from(img.data.buffer, img.data.byteOffset + y * img.w * 4, img.w * 4).copy(raw, y * (img.w * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
