import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// Tauri expects a fixed dev port and serves the built files from dist/.
export default defineConfig({
  plugins: [react()],
  // Workspace packages are used from their TypeScript sources (no build step).
  resolve: { conditions: ['source', ...defaultClientConditions] },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2022' },
});
