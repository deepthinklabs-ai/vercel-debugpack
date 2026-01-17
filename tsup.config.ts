import { defineConfig } from 'tsup';

export default defineConfig([
  // Browser bundle
  {
    entry: {
      'browser/index': 'src/browser/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    external: ['react', 'react-dom'],
    esbuildOptions(options) {
      options.jsx = 'automatic';
    },
  },
  // Server bundle
  {
    entry: {
      'server/index': 'src/server/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: false,
    platform: 'node',
  },
  // CLI bundle
  {
    entry: {
      'cli/index': 'src/cli/index.ts',
    },
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    clean: false,
    platform: 'node',
    target: 'node18',
  },
  // Main entry
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['react', 'react-dom'],
  },
]);
