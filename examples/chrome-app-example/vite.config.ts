import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'chrome-app',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        webview: resolve(__dirname, 'webview.js'),
      },
      output: {
        format: 'iife',
        entryFileNames: '[name].js',
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: resolve(__dirname, 'index.html'), dest: '.' },
        { src: resolve(__dirname, 'style.css'), dest: '.' },
        { src: resolve(__dirname, 'manifest.json'), dest: '.' },
        { src: resolve(__dirname, 'background.js'), dest: '.' },
      ],
    }),
  ],
  // This alias ensures that `import 'sso-offloading-connector'` correctly
  // resolves to the source code within monorepo during the build. 
  resolve: {
    alias: {
      'sso-offloading-connector': resolve(
        __dirname,
        '../../packages/sso-offloading-connector/src/index.ts'
      ),
    },
  },
});
