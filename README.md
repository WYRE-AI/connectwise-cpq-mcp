# connectwise-cpq-mcp

MCP server for [ConnectWise CPQ (Sell)](https://developer.connectwise.com/Products/ConnectWise_CPQ) —
quotes, line items, customers, terms, tabs, templates, tax codes, recurring revenues, and users.

Built on the MCP **2026-07-28** spec via the split v2 SDK
(`@modelcontextprotocol/server` / `/node` / `/client` `^2.0.0-beta.5`) with **dual-era
serving**: one shared `McpServerFactory` behind `createMcpHandler({ legacy: 'stateless' })`
answers both 2025-era `initialize`-handshake clients (the WYRE gateway today) and modern
2026-07-28 envelope clients — with an identical, deterministic 25-tool surface for every
caller. Ships as a GHCR container only (no MCPB bundle).

## Tools (25, flat)

Reads: `cpq_test_connection`, `cpq_search_quotes`, `cpq_get_quote`, `cpq_get_quote_versions`,
`cpq_search_quote_items`, `cpq_get_quote_item`, `cpq_list_quote_customers`,
`cpq_search_quote_tabs`, `cpq_list_quote_terms`, `cpq_list_templates`, `cpq_list_tax_codes`,
`cpq_list_recurring_revenues`, `cpq_list_users`.

Writes: `cpq_create_quote_from_template`, `cpq_update_quote` (⚠ HIGH-IMPACT),
`cpq_create_quote_item`, `cpq_update_quote_item`, `cpq_update_quote_customer`,
`cpq_create_quote_term`, `cpq_update_quote_term`, and the ⚠ DESTRUCTIVE — IRREVERSIBLE
deletes: `cpq_delete_quote_item`, `cpq_delete_quote_term`, `cpq_delete_quote_customer`,
`cpq_delete_quote_version`, `cpq_delete_quote`.

Quote creation is copy-only (`/api/quotes/copyById`) — the CPQ API has no create-from-scratch,
publish/e-sign, order-porting, PDF, or product-catalog endpoints (pair with connectwise-psa
for those).

## Credentials

CPQ requires an **API user** and CPQ 2022.2+. Three parts, all required:

| Env var (env mode) | Gateway header (`AUTH_MODE=gateway`) | Where to find it |
|---|---|---|
| `CPQ_ACCESS_KEY` | `X-CPQ-Access-Key` | Sell URL: `...home?accesskey=<this>` |
| `CPQ_PUBLIC_KEY` | `X-CPQ-Public-Key` | Settings → Organization Settings → API Keys |
| `CPQ_PRIVATE_KEY` | `X-CPQ-Private-Key` | Shown once at key creation |

In gateway mode a request missing any header is answered `401` (JSON-RPC error `-32001`)
before the MCP handler runs — it never falls through to env credentials.

## Running

```bash
export NODE_AUTH_TOKEN=$(gh auth token)   # GitHub Packages auth for @wyre-technology/*
npm install
npm run build
node dist/index.js                        # stdio (default)
MCP_TRANSPORT=http node dist/index.js     # HTTP on :8080 (/mcp, /health)
node scripts/smoke-dual-era.mjs           # proves both protocol eras serve the same tools
```

> **Local-dev note:** `@wyre-technology/node-connectwise-cpq` is declared at `^1.0.0` but is
> not yet published; until the SDK's first release lands, `npm ci` from a fresh clone fails.
> Install the locally built SDK tarball instead:
> `npm install /path/to/wyre-technology-node-connectwise-cpq-0.0.0-semantically-released.tgz`
> (then keep `package.json` at `^1.0.0`).

Docker (linux/amd64 per fleet law):

```bash
docker build --platform linux/amd64 --build-arg GITHUB_TOKEN=$(gh auth token) \
  -t connectwise-cpq-mcp .
docker run -p 8080:8080 -e CPQ_ACCESS_KEY=... -e CPQ_PUBLIC_KEY=... -e CPQ_PRIVATE_KEY=... \
  connectwise-cpq-mcp
```

## MCP Apps quote card

`cpq_get_quote` advertises a read-only MCP Apps card
(`ui://connectwise-cpq/quote-card.html`) showing the quote header, status badges, a
line-item summary, and totals. The card is purely additive: hosts without MCP Apps support
get the full QuoteView JSON (the `_card` field is extra, never a replacement), and any card
build failure leaves the JSON untouched. Rebuild the embedded UI with `npm run build:ui`
(output committed at `src/generated/quote-card-html.ts`). Brand at serve time via
`MCP_BRAND_*` env vars.

## Elicitation and destructive-action consent

Where the connected client supports elicitation, the server asks before acting: date range
on unfiltered quote searches, template pick on ambiguous names, tab pick when adding items,
and confirmation before every delete. Elicitation rides the SDK v2 MRTR seam: handlers
return `input_required` results (embedded `elicitation/create` requests) that 2026-07-28
clients fulfil and retry, and that the SDK's legacy shim fulfils server-side for 2025-era
stateful connections (stdio). All elicitation is MRTR-safe: no vendor mutation ever fires
before an elicitation point, so a client retry of the original request cannot duplicate a
write.

Callers that never declared the form-elicitation capability — including stateless legacy
HTTP requests, which is how the WYRE Conduit gateway connects — cannot be prompted at all.
What that means depends on the stakes:

- **Optional** elicitation degrades gracefully (design.md §4): an unfiltered search falls
  back to a default 90-day range and says so, and the ambiguous template/tab pickers
  return an error listing the candidates.
- **Destructive** tools fail closed. A client that cannot answer has not consented, so the
  five `cpq_delete_*` tools refuse to run and return an actionable error naming what to do.
  A non-interactive caller opts in per call with `"confirm_destructive_action": true`,
  declared in each destructive tool's input schema so the gate is actually satisfiable.
  That argument is consulted *only* when no prompt is possible — it can never skip a
  confirmation an interactive user would otherwise have seen.

## Vendor quirks encoded here

- Missing `Authorization` header → CPQ answers **500** (not 401); credentials are validated
  client-side before any request.
- The real 401 body carries a vendor typo (`"...has occured during basic auth validation"`).
- `Content-Type: application/json; version=1.0` on every request (media-type versioning).
- List responses are bare JSON arrays — pagination terminates on a short page.
- Condition dates must be date-only and bracketed: `createDate >= [2026-07-01]`.
- PATCH bodies are RFC 6902 JSON Patch arrays.

## License

Apache-2.0 © WYRE Technology
