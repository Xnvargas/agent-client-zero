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
  // Server bundle - use named entry to flatten output path
  // This ensures output is dist/server.js instead of dist/server/index.js
  // which matches the package.json exports configuration
  {
    entry: { server: 'src/server/index.ts' },
    outDir: 'dist',
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'react-dom'],
    clean: false,
  },
]);