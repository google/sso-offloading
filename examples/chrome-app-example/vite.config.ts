/*
 Copyright 2025 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

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
