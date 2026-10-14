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

Copy [`.env.example`](.env.example) for local configuration. Leave `CONDUIT_S2S_SECRET` empty in that file.

| Variable | Required | Description |
|---|---|---|
| `CPQ_ACCESS_KEY`, `CPQ_PUBLIC_KEY`, `CPQ_PRIVATE_KEY` | For stdio and `AUTH_MODE=env` | ConnectWise CPQ API user keys. The gateway Compose service does not set these. |
| `MCP_TRANSPORT` | No | `stdio` (default) or `http` |
| `AUTH_MODE` | No | `gateway` (Docker image and Compose default) or `env`. Gateway mode requires the three `X-CPQ-*` headers on each `/mcp` request and never falls back to `CPQ_*`. `env` uses those variables only after S2S auth succeeds. |
| `CONDUIT_S2S_SECRET` | Yes for HTTP | Service-to-service secret. The HTTP server logs an error and exits non-zero when this is empty or a known placeholder (`changeme`, `replace-with-a-real-secret`, and the other public example values). Compose will not start without it. Never commit a real value. Generate one with `openssl rand -hex 32`. |
| `MCP_ALLOW_INSECURE_DEV` | No | Set to exactly `1` only for local development to start HTTP without `CONDUIT_S2S_SECRET`. The process logs a warning and does not enforce `X-Gateway-S2S`. The listener is forced to `127.0.0.1` even if `MCP_HTTP_HOST` is a wider address such as `0.0.0.0`. A placeholder secret is still refused. |
| `MCP_HTTP_HOST` | No | Bind address when `MCP_TRANSPORT=http`. Defaults to `127.0.0.1`. Honored when `CONDUIT_S2S_SECRET` is set. The container image sets `0.0.0.0`. |
| `MCP_HTTP_PORT` | No | HTTP port. Defaults to `8080`. |

`/health` and `/healthz` stay unauthenticated and do not read credentials. The stdio transport does not use `CONDUIT_S2S_SECRET`.

### HTTP authentication

With `MCP_TRANSPORT=http` and `CONDUIT_S2S_SECRET` set, every `/mcp` request must include `X-Gateway-S2S`. The check is `verifyS2sHeader` in [`src/s2s-verify.ts`](src/s2s-verify.ts): the header value is `t=<unix seconds>,v1=<hex>`, where the hex is HMAC-SHA256 of the literal string `t=<unix seconds>` keyed with `CONDUIT_S2S_SECRET` (64 lowercase hex characters). The timestamp must be within 300 seconds of the server clock. A missing or invalid header returns 401 before vendor credentials are read.

```bash
TS=$(date +%s)
SIG=$(printf 't=%s' "$TS" | openssl dgst -sha256 -hmac "$CONDUIT_S2S_SECRET" -hex | awk '{print $NF}')
curl -sS http://127.0.0.1:8080/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "X-Gateway-S2S: t=${TS},v1=${SIG}" \
  -H 'X-CPQ-Access-Key: your-access-key' \
  -H 'X-CPQ-Public-Key: your-public-key' \
  -H 'X-CPQ-Private-Key: your-private-key' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

In `AUTH_MODE=gateway` those three `X-CPQ-*` headers are the only credential source for that request. With `AUTH_MODE=env`, a signed request uses `CPQ_ACCESS_KEY`, `CPQ_PUBLIC_KEY`, and `CPQ_PRIVATE_KEY` from the environment when the headers are absent.

## Running

```bash
export NODE_AUTH_TOKEN=$(gh auth token)   # GitHub Packages auth for @wyre-ai/*
npm install
npm run build
node dist/index.js                        # stdio (default)
CONDUIT_S2S_SECRET="$CONDUIT_S2S_SECRET" MCP_TRANSPORT=http node dist/index.js
node scripts/smoke-dual-era.mjs           # proves both protocol eras serve the same tools
```

Local HTTP without a secret is development-only. It binds `127.0.0.1` (a non-loopback `MCP_HTTP_HOST` is overridden and logged) and logs a warning:

```bash
MCP_TRANSPORT=http MCP_ALLOW_INSECURE_DEV=1 node dist/index.js
```

> **Local-dev note:** `@wyre-technology/node-connectwise-cpq` is declared at `^1.0.0` but is
> not yet published; until the SDK's first release lands, `npm ci` from a fresh clone fails.
> Install the locally built SDK tarball instead:
> `npm install /path/to/wyre-ai-node-connectwise-cpq-0.0.0-semantically-released.tgz`
> (then keep `package.json` at `^1.0.0`).

Docker (linux/amd64 per fleet law):

The image listens on `0.0.0.0` inside the container (`MCP_HTTP_HOST`) and defaults to `AUTH_MODE=gateway`. Publish the port on loopback and pass the S2S secret. In gateway mode, CPQ credentials arrive on each request as headers; they are not read from the environment.

```bash
docker build --platform linux/amd64 --build-arg GITHUB_TOKEN=$(gh auth token) \
  -t connectwise-cpq-mcp .
docker run \
  -e CONDUIT_S2S_SECRET \
  -p 127.0.0.1:8080:8080 \
  connectwise-cpq-mcp
```

Compose refuses to start when `CONDUIT_S2S_SECRET` is unset, defaults `AUTH_MODE` to `gateway`, publishes `127.0.0.1:8080:8080`, and does not inject `CPQ_ACCESS_KEY`, `CPQ_PUBLIC_KEY`, or `CPQ_PRIVATE_KEY`:

```bash
export CONDUIT_S2S_SECRET="$(openssl rand -hex 32)"
GITHUB_TOKEN=$(gh auth token) docker compose up
```

Single-tenant HTTP (`AUTH_MODE=env`) still requires the S2S secret, then uses the `CPQ_*` variables:

```bash
docker run \
  -e CONDUIT_S2S_SECRET \
  -e AUTH_MODE=env \
  -e CPQ_ACCESS_KEY=... \
  -e CPQ_PUBLIC_KEY=... \
  -e CPQ_PRIVATE_KEY=... \
  -p 127.0.0.1:8080:8080 \
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
