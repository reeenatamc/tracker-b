# deploy

`vercel.json` is copied into `dist/client` by `npm run deploy`. Vercel's schema rejects
unknown keys, so the reasoning lives here instead of as comments in the file.

- **`rewrites`** — SPA fallback to `_shell.html`. Vercel matches real files first, so
  `/assets/*` and `/sw.js` still resolve to themselves.
- **`/assets/*` immutable** — filenames are content-hashed, so they never change meaning.
- **`/sw.js` must-revalidate** — the worker decides what is cached, so it can never be cached
  itself, or an update could never reach the device.
- **`X-Robots-Tag: noindex`** — the bundle contains the training program, which is personal.
  Deployment Protection is the actual control; this just keeps it out of search results.

## Why the build is local

`npm run deploy` builds here and uploads only `dist/client`. The program lives in `content/`,
which is gitignored — building on Vercel would produce the generic example instead. It also
means the raw YAML never reaches Vercel's build system, only the compiled bundle.
