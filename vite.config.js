import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Sub-path for project Pages (e.g. /mytools/); set by the deploy workflow.
  // Defaults to '/' for Cloud Run / nginx / local dev.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: { port: 5173, host: true },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Stable vendor chunks → long-cached separately from app code, so
        // shipping an app change doesn't re-download React/Supabase.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@supabase')) return 'supabase';
          if (id.includes('react')) return 'react';
          return 'vendor';
        }
      }
    }
  }
});
