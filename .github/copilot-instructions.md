# copilot-cost — Copilot instructions

`copilot-cost` is a local-only CLI + dashboard that reads OpenTelemetry traces emitted by the GitHub Copilot CLI (`~/.copilot/otel/*.jsonl`), aggregates `gen_ai.usage.*` counters by session/model/day, multiplies them by a bundled pricing snapshot, and renders a statusline or local web dashboard. It is a community project — not affiliated with GitHub. Never add network egress for usage data; the tool is privacy-by-design (dashboard binds only to `127.0.0.1` / `localhost`; pricing refresh is the only outbound call).

## Commands

- `npm install` — install deps.
- `npm run lint` — type-check only (`tsc --noEmit`). There is no ESLint.
- `npm test` — run the Vitest suite (`tests-ts/**/*.test.ts`, node environment).
- `npm run test:watch` — Vitest watch mode.
- Run a single test file: `npx vitest run tests-ts/render.test.ts`
- Run a single test by name: `npx vitest run -t "renders compact format"`
- `npm run build` — builds the dashboard UI (`scripts/build-ui.mjs` → `dashboard-ui/dist/`) **and** the CLI (`tsup` → `dist/cli.js`). The Playwright e2e webServer and `npm run cli` rely on `dist/` being current.
- `npm run test:e2e` — Playwright tests in `tests-e2e/`. The webServer rebuilds and launches `dist/cli.js dashboard` against an isolated `HOME=.test-home/e2e`.
- `npm run cli -- <args>` — build then run the CLI locally (e.g. `npm run cli -- doctor`).
- `npm run local:install` / `local:uninstall` / `local:doctor` / `local:dashboard` — exercise the installer flows against your real `$HOME`.

CI (`.github/workflows/ci.yml`) runs `lint`, `test`, `build` on Node 18/20/22 (Ubuntu). Keep all three green; the project targets `node18` (`tsup`) and `engines.node >= 18`.

## Architecture

Pipeline: **Copilot CLI → JSONL OTel spans → reader → parser → aggregations → render / dashboard**.

- `src/cli.ts` — Commander entry point. Subcommands: `render` (default, reads status JSON from stdin), `install`, `uninstall`, `doctor`, `dashboard`, `refresh-pricing`. The `bin` is `dist/cli.js` (ESM, shebang injected by `tsup`).
- `src/otel/` — telemetry plane. `paths.ts` resolves the JSONL location (env-overridable via `COPILOT_OTEL_DIR` / `COPILOT_OTEL_FILE_EXPORTER_PATH`). `reader.ts` tails files with an mtime+size cache and dedupes spans by `dedup_key`. `parser.ts` normalizes a raw span into a `NormalizedCall`. `aggregations.ts` rolls calls up by session/model/day.
- `src/pricing/` — `fetcher.ts` refreshes pricing from `docs.github.com` into `~/.copilot/cost-cache/pricing.yaml` with a TTL; `loader.ts` exposes `normalizeModel`, `getModelPrice`, `computeCost`. `pricing.snapshot.yaml` at the repo root is the bundled fallback shipped in the npm package.
- `src/render.ts` — pure function `renderPayload(payload)` that turns Copilot's status-JSON payload into the one-line statusline. Honors `COPILOT_COST_FORMAT` (`standard|compact|full` + aliases), `COPILOT_COST_NO_COLOR`/`NO_COLOR`, `COPILOT_COST_COLOR`, `COPILOT_COST_HIDE_ZERO`. Side-effect: appends to session-meta via `util/session-meta.ts`.
- `src/install.ts` — installer/uninstaller/doctor. Edits `~/.copilot/settings.json` (must set `"experimental": true` or the Copilot CLI ignores `statusLine`) and inserts an idempotent block between `OTEL_BEGIN`/`OTEL_END` markers in the user's shell profile (POSIX or PowerShell). Anything writing to the user's profile must stay between those markers so `uninstall` can remove it cleanly.
- `src/dashboard/server.ts` — local HTTP server. Serves the prebuilt `dashboard-ui/dist/` static assets and a JSON API consumed by `dashboard-ui/app.js`. Must reject non-loopback hosts.
- `dashboard-ui/` — vanilla HTML/JS + Tailwind. `styles.src.css` is compiled by `scripts/build-ui.mjs` into `dashboard-ui/dist/styles.css` along with `index.html` and `app.js`. The `dist/` is generated; rebuild after UI edits (`npm run build:ui`).

## Conventions

- **TypeScript ESM, strict mode** with `noUncheckedIndexedAccess` and `noImplicitOverride`. Imports of local files **must** use the `.js` extension (e.g. `import { renderPayload } from "./render.js"`) even though the source is `.ts` — required for ESM + `tsup`.
- Tests live in `tests-ts/` (unit, Vitest) and `tests-e2e/` (Playwright). Tests are excluded from `tsconfig` `include`. Fixtures live under `tests/fixtures/`.
- Tests that touch the user's home must redirect via `HOME=.test-home/...` (see `playwright.config.ts`). Never write to the real `~/.copilot` from tests. `.test-home/` and `.test-work/` are scratch dirs already in `.gitignore` territory.
- The render path must be **resilient to malformed payloads** — `cli.ts` catches parse errors and prints `💰 ⚠ bad payload: ...`. New fields read from the status JSON should go through the `asObject` / `intValue` / `strValue` helpers in `render.ts` rather than direct property access.
- The OTel reader **caches per file by `mtimeMs` + `size`**. If you change parsing, also call `clearCache()` in tests, and preserve the dedup-by-`dedup_key` invariant.
- Pricing lookups go through `normalizeModel` so model id variants collapse to a single canonical key — add new aliases there, not at call sites.
- The `dashboard` command must continue to refuse non-loopback binds; `--host` accepts only `127.0.0.1` / `localhost`. Same constraint applies to any new server features.
- Don't introduce a runtime database, daemon, or analytics — these are explicit non-goals (see README "Why copilot-cost?"). Stick to file I/O + in-memory aggregation.
- Windows support matters: the installer branches on `process.platform === "win32"` and writes a PowerShell profile block instead of POSIX. Anything path/shell-related needs both branches.
- `pricing.snapshot.yaml` is shipped in the published `files` list and is the offline fallback — keep it valid YAML and refresh via `copilot-cost refresh-pricing --force`, don't hand-edit values.
