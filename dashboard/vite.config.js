import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds to ../dashboard-dist with a stable, unhashed filename — the vanilla
// shell (../index.html) loads it via a plain <script type="module"> tag and
// has no manifest to resolve a hashed name against.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dashboard-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/main.jsx',
      output: {
        entryFileNames: 'dashboard.js',
        assetFileNames: 'dashboard.[ext]',
        chunkFileNames: 'dashboard-[name].js',
      },
    },
  },
});
