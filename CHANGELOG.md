# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are cut by semantic-release from Conventional Commits.

## [Unreleased]

### Added

- Initial ConnectWise CPQ (Sell) MCP server: flat 25-tool surface (13 reads, 12 writes)
  over `@wyre-technology/node-connectwise-cpq` — quotes, versions, line items, customers,
  tabs, terms, templates, tax codes, recurring revenues, and users.
- Dual-era serving on the v2 SDK (`^2.0.0-beta.5`): one shared `McpServerFactory` via
  `createMcpHandler({ legacy: 'stateless' })` + `toNodeHandler` for HTTP and `serveStdio`
  for stdio; identical deterministic tool list for every caller and both protocol eras
  (proved by `scripts/smoke-dual-era.mjs`).
- Gateway mode (`AUTH_MODE=gateway`): per-request credential binding from the
  `X-CPQ-Access-Key` / `X-CPQ-Public-Key` / `X-CPQ-Private-Key` headers, with a 401
  JSON-RPC (-32001) gate in the HTTP layer before the MCP handler — no env fallback.
- Destructive-tool tiering per fleet convention §2.7b: ⚠ DESTRUCTIVE — IRREVERSIBLE on the
  five deletes (idempotentHint:false), ⚠ HIGH-IMPACT on `cpq_update_quote`
  (idempotentHint:true), enforced by `scripts/lint-destructive-warnings.mjs` in CI.
- MRTR-safe elicitation on the SDK v2 `inputRequired` seam: date-range prompt on
  unfiltered quote searches, template disambiguation, quote-tab selection, and delete
  confirmations — always before the single mutating vendor call. Handlers return
  `input_required` results that 2026-07-28 clients fulfil and retry (and the SDK's legacy
  shim fulfils server-side for 2025-era stateful connections); callers without the
  form-elicitation capability, including stateless legacy HTTP requests, keep the
  pre-elicitation fallback behavior.
- MCP Apps quote card on `cpq_get_quote` (`ui://connectwise-cpq/quote-card.html`,
  ext-apps `^1.7.3`, vite single-file, committed embed): read-only render of quote header,
  badges, line summary, totals; additive `_card` field so non-App hosts get full JSON.
  The card build lives in its own private `ui/` package (no lockfile,
  `npm run build:ui` installs it on demand) so ext-apps' v1 `@modelcontextprotocol/sdk`
  peer never enters the server package's dependency graph or lockfile — the v2 migration
  contract bans the v1 SDK there.
- GHCR container (node:22-alpine multi-stage, non-root, linux/amd64), MCP Registry
  `server.json`, fleet CI via the centralized reusable release workflow.

### Notes

- `@wyre-technology/node-connectwise-cpq` is declared at `^1.0.0` ahead of the SDK's first
  semantic-release publish; local development installs the built SDK tarball, and a fresh
  `npm ci` will fail until the package is published to GitHub Packages.
