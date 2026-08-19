# tracker-b

*[Léeme en español](README.es.md)*

A training tracker that works with no internet, because it gets used standing
up, one-handed, between sets.

## Why it exists

It started as an eight-sheet spreadsheet: a nineteen-week programme covering
full-body strength, ankle rehab, cardio and nutrition. The spreadsheet was a
good plan and a bad logger — nobody fills in fifteen columns at the gym. This
splits the two: the plan is content, the log is a database, and everything else
is derived.

## What makes it worth the trouble

The progression rules are deterministic:

> Hold the weight until you complete the top of the rep range on every set with
> clean technique and RIR near the phase target; then add the smallest
> increment.

That is a pure function. The "next target" column that used to be filled in by
hand is now computed, and opening an exercise pre-fills the load and reps from
what the programme says and what you did last time.

One rule overrides all the others: if there is meaningful pain (≥ 3/10),
swelling, or an instability episode, the app **will not suggest going heavier**.
The logic does not push weight on top of a warning sign.

## Stack

| Piece | For |
|---|---|
| TanStack Start (SPA) | File-based routing. No SSR — there is nothing a server could render |
| TanStack DB + wa-sqlite | Real SQLite in the browser over OPFS; writes never touch the network |
| Zod | Validates content at boot; the types are inferred from it |
| Tailwind 4 · Biome · Vitest | Styles, formatting and lint, tests |

The service worker is hand-written (`plugins/service-worker.ts`): it precaches
the whole build and serves cache-first. `vite-plugin-pwa` never emits a worker
under TanStack Start's two-environment build.

## Privacy

This repository is public and holds **code only**.

```
content/           gitignored — your programme, your menu, your planning
data/              gitignored
*.xlsx             gitignored
content.example/   public — a generic sample so the repo runs
```

Your logs live in the browser on your device, in OPFS. No server ever sees them.
The `@content` alias points at `content/` when it exists and `content.example/`
when it does not, so a clean clone builds and runs without any of your data.

## Structure

```
src/domain/         pure logic, no React, covered by tests
  progression.ts      double progression -> next target
  phases.ts           date -> phase -> sets and RIR
  schedule.ts         day -> session
  safety.ts           warning signs block progression
  history.ts          what you did last time
src/db/             TanStack DB collections and persistence
src/routes/         / · /ankle · /history
```

## Getting started

```bash
npm install
npm run dev            # http://localhost:4310
```

It starts fine without `content/`, using the example programme.

## Licence
MIT
