import { defineConfig } from 'vitest/config';

/**
 * Separate from vite.config.mjs, which roots itself at src/renderer for the
 * Electron window build and would otherwise hide every test in the project.
 */
export default defineConfig({
  test: {
    root: process.cwd(),
    include: ['src/**/__tests__/**/*.test.mjs'],
  },
});
