import { defineConfig } from 'vitest/config'

/**
 * Deliberately separate from vite.config.ts: the domain layer is plain
 * TypeScript with no React, no router and no DOM, so the app's plugin chain
 * would only slow these tests down.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
