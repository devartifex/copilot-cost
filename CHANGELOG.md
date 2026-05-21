# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-05-21

### Changed

- Changed the statusline UX so `compact` / `minimal` default to estimated USD only, while `standard` and `full` show both estimated USD and GitHub AI Credits (AIC).
- Added `COPILOT_COST_METRIC` to choose `usd`, `aic`, or `both`, with friendly aliases for dollars, credits, and all metrics.
- Clarified README disclaimers that displayed costs are local estimates based on GitHub's published per-model pricing, not billing data or a guarantee of what GitHub will charge.
- Refreshed the bundled pricing snapshot from GitHub's published Copilot models and pricing data.

## [0.1.0] - 2026-05-14

Initial public release.

### Added

- Statusline renderer for the GitHub Copilot CLI with `standard`, `compact`, and `full` formats, configurable via `COPILOT_COST_FORMAT`, `COPILOT_COST_COLOR`, `COPILOT_COST_NO_COLOR`, and `COPILOT_COST_HIDE_ZERO`.
- One-line `copilot-cost install` that wires up the Copilot CLI statusline and appends an idempotent OpenTelemetry block to the user's shell profile (opt out with `--no-otel-profile`).
- Cross-platform installer support: POSIX shell shim on macOS and Linux, plus a `copilot-cost.cmd` shim and PowerShell profile OpenTelemetry setup on Windows.
- `copilot-cost uninstall` to cleanly revert settings owned by this tool.
- `copilot-cost doctor` to verify statusline setup, OpenTelemetry output, pricing freshness, and dashboard readiness.
- Local web dashboard (`copilot-cost dashboard`) bound to `127.0.0.1` by default, with Overview, Sessions, Models, Pricing, and Settings pages, light and dark themes, charts, and CSV export.
- OpenTelemetry JSONL reader and aggregator that rolls token usage up by session, model, and day from `~/.copilot/otel/*.jsonl`.
- Bundled pricing snapshot plus `copilot-cost refresh-pricing` (with `--force`) to pull the latest model pricing from the GitHub Docs.
- `/api/health` and `/api/install-otel` HTTP endpoints for the dashboard.

### Security & Privacy

- All usage data is read from local files; nothing is sent to third parties.
- Dashboard server refuses non-loopback hosts.
- No analytics or telemetry emitted by this package.
