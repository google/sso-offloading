import { defineConfig } from 'tsup';
import pkg from './package.json';

const libName = pkg.name;

export default defineConfig({
  entry: {
    [libName]: 'src/sso_offloading_connector.ts',
  },
  format: ['esm', 'cjs'],
  outExtension({ format }) {
    if (format === 'esm') return { js: `.js` };
    if (format === 'cjs') return { js: `.umd.cjs` };
    return { js: `.${format}.js` };
  },
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
});
