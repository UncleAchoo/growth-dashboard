import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Produces a single self-contained dist/index.html with all JS + CSS inlined.
// Google Fonts (Fraunces / Manrope / Geist Mono) are still pulled at runtime
// via the <link> tag in index.html — swap to self-hosted woff2 if Mutiny's
// CSP blocks external font fetches.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    // The mounted dist/ folder on the host doesn't allow unlinking files, so
    // skip vite's pre-build empty step. Build still overwrites index.html.
    emptyOutDir: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
