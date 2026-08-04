# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are cut by semantic-release from Conventional Commits.

## [Unreleased]

### Security

- Destructive tools now **fail closed** when the client cannot be prompted. `unavailable`
  elicitation was previously treated as consent, so on the deployment that matters — the
  WYRE Conduit gateway, a non-interactive stateless caller — every `cpq_delete_*` tool ran
  with no confirmation at all, while the CPQ plugin skills documented that deletes "ask for
  confirmation first". The five delete tools now refuse to run for a caller that declared
  no elicitation capability unless it passes the new `confirm_destructive_action: true`
  argument, and the refusal names that argument. Interactive clients are unaffected: the
  prompt still fires and the new argument cannot suppress it. Optional (non-destructive)
  elicitation keeps its permissive fallback, so non-interactive callers retain the full
  read and non-destructive write surface.

### Changed

- Dropped the `deploy` job from the release workflow. ConnectWise CPQ is a
  conduit-only vendor: the fleet-standard `mcp-server-deploy.yml` targets
  `gwp-<slug>` in the separate, still-live legacy `mcp-gateway-prod` fleet, not
  conduit, whose sidecars deploy from conduit's own `vendor-fleet` bicepparam.
  With no `gwp-connectwise-cpq` Container App the job could only fail, and on
  v1.0.0 it did (`AADSTS7002131` — no federated identity credential for this
  repo). Matches scalepad-mcp and clio-mcp, the other conduit-only vendors.
  The release, Docker, security-scan and MCP Registry jobs are unaffected.

### Added

- `confirm_destructive_action` (boolean, optional) on `cpq_delete_quote`,
  `cpq_delete_quote_version`, `cpq_delete_quote_item`, `cpq_delete_quote_term` and
  `cpq_delete_quote_customer` — the explicit consent path for non-interactive callers
  behind the fail-closed gate above. Declared in each tool's input schema, so gateway
  callers can actually satisfy it.

- `scripts/smoke-dual-era.mjs` gained a third leg exercising `AUTH_MODE=gateway`
  end-to-end against the real HTTP entrypoint: with the `CPQ_*` env vars stripped from
  the child process, it asserts that missing and partial credential headers are both
  rejected with a 401 (-32001) naming the required headers, that complete headers return
  200, and that the gateway-bound tool surface matches the env-mode one. Previously the
  401 gate was covered only by a unit test against a hand-mirrored copy of the router,
  so router drift — or a regression into env-credential fallthrough, which would be a
  cross-tenant leak — could not have been caught.

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
  pre-elicitation fallback behavior for the non-destructive prompts — the delete
  confirmations fail closed instead (see Security above).
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
