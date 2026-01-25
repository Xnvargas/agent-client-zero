import { defineConfig } from 'tsup';

export default defineConfig([
  // Main bundle (client-side)
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['react', 'react-dom', '@carbon/ai-chat'],
    treeshake: true,
    splitting: false,
    minify: false,
    banner: {
      js: '"use client";',
    },
  },
  // Server bundle - named entry for flat output (dist/server.js)
  {
    entry: { server: 'src/server/index.ts' },
    outDir: 'dist',
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom'],
    clean: false,
  },
  // Styles bundle - copy CSS to dist
  {
    entry: ['src/styles/index.css'],
    outDir: 'dist/styles',
    clean: false,
  },
]);