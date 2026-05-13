# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

### Breaking

- Rewritten in TypeScript.
- Removed runtime SQLite. Data now sourced from `~/.copilot/otel/*.jsonl`. One-shot migration via `copilot-cost migrate` (or first `dashboard` launch).

### Added

- One-line install (`copilot-cost install`); auto-configures Copilot CLI OTel JSONL exporter via shell profile.
- Redesigned dashboard (Tailwind + shadcn-style tokens, light + dark, sidebar nav, Overview / Sessions / Models / Pricing / Settings pages, charts).
- `/api/health`, `/api/install-otel` endpoints.

### Changed

- Dashboard server now serves redesigned UI.

## Pre-community

- Initial Python implementation of the local Copilot cost statusline and dashboard.
