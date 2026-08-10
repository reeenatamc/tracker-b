import { defineConfig } from 'vitest/config'

/**
 * Deliberately separate from vite.config.ts: the domain layer is plain
 * TypeScript with no React, no router and no DOM, so the app's plugin chain
 * would only slow these tests down.
 */
export default defineConfig({
  test: {
    // `api/` is covered too: the reminder decides what day it is in someone
    // else's time zone, which is exactly the kind of thing that is quietly wrong.
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    environment: 'node',
  },
})
