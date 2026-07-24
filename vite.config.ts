/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      // The constitution's 80%-line target is specifically on the pure
      // core layer, so coverage is scoped there — measuring the engine,
      // viewport, or React harness (much of which is only exercisable in a
      // real browser, not this Node test env) would report a misleadingly
      // low number that doesn't reflect what the target is actually about.
      include: ['src/core/**/*.ts'],
      // Benchmarks and the manifold spike are throwaway/measurement code,
      // not core algorithms the coverage target is meant to guard.
      exclude: ['src/core/**/*.test.ts', 'src/core/__bench__/**', 'src/core/**/__spike__/**'],
      reporter: ['text', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
});
