import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { yamlContent } from './plugins/yaml-content.ts'

/**
 * Deliberately separate from vite.config.ts: the domain layer is plain
 * TypeScript with no React, no router and no DOM, so the app's plugin chain
 * would only slow these tests down.
 */
export default defineConfig({
  // `domain/` imports relatively and needs nothing, but `lib/` uses the app's
  // own `@/` alias — and `lib/backup.ts` is the one file standing between a
  // cleared browser and a lost training log, so it has to be reachable here.
  //
  // `@content` points at the public example and never at `content/`, which is
  // gitignored personal planning. A test whose expectations depend on private
  // data is a test that fails on a fresh clone and quietly encodes her
  // programme into the repo.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@content': fileURLToPath(new URL('./content.example', import.meta.url)),
    },
  },
  // The only reason the app's build pipeline shows up here at all: without it,
  // every module that reads content is untestable.
  plugins: [yamlContent()],
  test: {
    // `api/` is covered too: the reminder decides what day it is in someone
    // else's time zone, which is exactly the kind of thing that is quietly wrong.
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    environment: 'node',
  },
})
