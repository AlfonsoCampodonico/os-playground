# SO Playground

Interactive simulators for the Operating Systems course at FIUBA ([fisop](https://fisop.github.io/website/)): one page per topic of the 2026/2 calendar, all in the browser, in Spanish and English. Independent project, not official course material.

Where OSTEP has a homework simulator (`scheduler.py`, `paging-policy.py`, `vsfs.py`, `x86.py`, …), the playground reproduces its semantics and, for the same `-s` seed, the same problems and answers. `src/lib/pyrandom.ts` is a bit-exact port of CPython's `random` for that.

## Develop

Needs Node ≥ 22.23 (see `.nvmrc`).

```sh
npm install
npm run dev      # http://localhost:4321
npm test         # simulator tests (vitest), incl. golden outputs recorded from the OSTEP scripts
npm run test:ostep  # also compares live against the OSTEP python scripts (clones them into .ostep-homework/)
npm run check    # astro check (types)
npm run build    # static site in dist/
```

## Layout

- `src/lib/playgrounds.ts`: the list of topics (titles, ledes, course week, OSTEP chapter). Drives the home page, nav and prev/next links.
- `src/sim/<topic>.ts`: pure simulators (config in, `steps[]` snapshots out) with tests next to them.
- `src/playgrounds/<topic>/`: the React island for each page.
- `src/components/kit/`: shared UI (panels, controls, step player, URL state, i18n).
- `src/pages/[...lang]/<topic>.astro`: routes. Spanish at `/<topic>`, English at `/en/<topic>`.
- `src/styles/global.css`: design tokens (light and dark).

Every playground keeps its setup in the URL query, so a link reproduces the exact example.

## Deploy

Pushing to `main` builds and publishes to GitHub Pages (`.github/workflows/deploy.yml`). In the repo settings, set Pages → Source to "GitHub Actions".
