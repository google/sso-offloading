import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/service_worker.ts', 
      name: 'service_worker',
      fileName: 'service_worker',
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        // This is important to ensure a single, clean output file
        // name that you can reference in your manifest.json.
        entryFileNames: `service_worker.js`,
        chunkFileNames: `service_worker.js`,
      }
    },
    // emptyOutDir: true,
  }
});