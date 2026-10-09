import { defineConfig } from 'vite-plus'

export default defineConfig({
  define: {
    __AGENTHUB_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    // Keep Playwright specs out of the unit-test run.
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    // Isolate tests from the user's production ~/.spool data.
    setupFiles: ['./test-setup.ts'],
  },
})
