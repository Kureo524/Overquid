import { defaultClientConditions, defineConfig } from 'vite';

// Plugins are served from their own folder: relative URLs only. Vite adds
// `crossorigin` to the tags it emits, which the plugin's opaque origin needs.
export default defineConfig({
  base: './',
  resolve: { conditions: ['source', ...defaultClientConditions] },
  build: { target: 'es2022', outDir: 'dist' },
});
