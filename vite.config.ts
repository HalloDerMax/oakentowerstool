/* Build of the overlay pages (panel + hints). They use the simulator, game data and item pictures copied
 * from the Oaken Tower Fan Hub into shared/ (npm run sync); the result goes to app/renderer.
 * The text reader's files (Tesseract) are served / copied under ocr/, so it works offline. */
import fs from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';

const OCR_FILES: Record<string, string> = {
  'worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};
function ocrFiles(): Plugin {
  return {
    name: 'ocr-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/ocr\/([^?]+)/.exec(req.url ?? '');
        const src = m && OCR_FILES[m[1]!];
        if (!src) return next();
        res.setHeader('Content-Type', src.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        fs.createReadStream(resolve(__dirname, src)).pipe(res);
      });
    },
    generateBundle() {
      for (const [name, src] of Object.entries(OCR_FILES))
        this.emitFile({ type: 'asset', fileName: 'ocr/' + name, source: fs.readFileSync(resolve(__dirname, src)) });
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, 'renderer'),
  base: './',
  publicDir: resolve(__dirname, 'shared/public'),
  plugins: [ocrFiles()],
  build: {
    outDir: resolve(__dirname, 'app/renderer'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: { panel: resolve(__dirname, 'renderer/panel.html'), hints: resolve(__dirname, 'renderer/hints.html') } },
  },
  worker: { format: 'es' },
  server: { port: 5318, strictPort: true, fs: { allow: [__dirname] } },
  test: { root: __dirname, environment: 'node', include: ['tests/**/*.test.ts'] },
});
