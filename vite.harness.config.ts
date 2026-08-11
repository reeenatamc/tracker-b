import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * A dev server for the T-001 harness, and nothing else.
 *
 * Separate from the app's config on purpose: the harness needs to own its own
 * navigation, and TanStack Start answers every HTML request with the app shell.
 * Its own origin also means its own OPFS, so hammering it cannot touch the real
 * log — which is the whole reason this is a second config and not a route.
 *
 * It never ships. Nothing in `npm run build` looks at this file.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./harness', import.meta.url)),
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 4500, strictPort: true },
  optimizeDeps: { exclude: ['@journeyapps/wa-sqlite'] },
})
