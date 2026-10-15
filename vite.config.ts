/* Build of the overlay pages (panel + hints). They use the simulator, game data and item pictures copied
 * from the Oaken Tower Fan Hub into shared/ (npm run sync); the result goes to app/renderer. */
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: resolve(__dirname, 'renderer'),
  base: './',
  publicDir: resolve(__dirname, 'shared/public'),
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
