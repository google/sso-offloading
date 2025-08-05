import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

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
        entryFileNames: `service_worker.js`,
        chunkFileNames: `service_worker.js`,
      }
    }
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'src/manifest.json',
          dest: '.'
        }
      ]
    })
  ]
});