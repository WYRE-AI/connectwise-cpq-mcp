/**
 * Shared MCP server factory for ConnectWise CPQ (Sell).
 *
 * This module is **side-effect free** (importing it never starts a transport)
 * so it can be reused by every entrypoint. One factory serves BOTH protocol
 * eras via the v2 SDK serving entries: legacy 2025-era clients (classic
 * `initialize` handshake) statelessly per request, and modern 2026-07-28
 * envelope clients natively.
 *
 * Statelessness is a protocol invariant here: `tools/list` returns the same
 * module-scope TOOLS array (by reference, deterministic order) for every
 * caller, every era, every request. No sessions, no per-user variance.
 */
import { Server } from "@modelcontextprotocol/server";
import type { McpServerFactory } from "@modelcontextprotocol/server";
import { CpqClient } from "@wyre-technology/node-connectwise-cpq";
import {
  CARD_RESOURCE_URI,
  MCP_APP_RESOURCE_MIME,
  applyBrandInjection,
  resolveBrandFromEnv,
} from "./card.builder.js";
import { QUOTE_CARD_HTML } from "./generated/quote-card-html.js";
import { handleToolCall } from "./handlers/index.js";
import { errorResult } from "./handlers/results.js";
import { setServerRef } from "./server-ref.js";
import { TOOLS } from "./tools.js";
import { logger } from "./utils/logger.js";

export const SERVER_NAME = "connectwise-cpq-mcp";
export const SERVER_VERSION = "1.0.0";

export interface CpqCredentials {
  accessKey: string;
  publicKey: string;
  privateKey: string;
}

/** Exact gateway header names (design.md §6) — lowercased by Node on receipt. */
export const GATEWAY_HEADERS = [
  "X-CPQ-Access-Key",
  "X-CPQ-Public-Key",
  "X-CPQ-Private-Key",
] as const;

/**
 * Build validated credentials from raw values. Returns `{ creds }` on
 * success or `{ error }` naming exactly what is missing. Shared by every
 * transport (env vars, Node HTTP gateway headers).
 */
export function buildCredentials(
  accessKey: string | undefined,
  publicKey: string | undefined,
  privateKey: string | undefined
): { creds?: CpqCredentials; error?: string } {
  const missing: string[] = [];
  if (!accessKey) missing.push("X-CPQ-Access-Key");
  if (!publicKey) missing.push("X-CPQ-Public-Key");
  if (!privateKey) missing.push("X-CPQ-Private-Key");
  if (missing.length > 0) {
    return {
      error:
        `Missing credentials: ${missing.join(", ")} ` +
        "(or CPQ_ACCESS_KEY / CPQ_PUBLIC_KEY / CPQ_PRIVATE_KEY in env mode)",
    };
  }
  return {
    creds: {
      accessKey: accessKey as string,
      publicKey: publicKey as string,
      privateKey: privateKey as string,
    },
  };
}

/** Resolve per-request gateway credentials from a (lowercased) header accessor. */
export function resolveGatewayCredentials(
  getHeader: (lowerName: string) => string | undefined
): { creds?: CpqCredentials; error?: string } {
  return buildCredentials(
    getHeader("x-cpq-access-key"),
    getHeader("x-cpq-public-key"),
    getHeader("x-cpq-private-key")
  );
}

/** Resolve env-mode credentials from CPQ_* environment variables. */
export function resolveEnvCredentials(
  env: Record<string, string | undefined> = process.env
): { creds?: CpqCredentials; error?: string } {
  return buildCredentials(env.CPQ_ACCESS_KEY, env.CPQ_PUBLIC_KEY, env.CPQ_PRIVATE_KEY);
}

/**
 * Bind createMcpServer into the McpServerFactory shape the v2 HTTP serving
 * entry (createMcpHandler) consumes. The factory runs once per HTTP request —
 * the fresh-instance-per-request stateless idiom — for BOTH protocol eras.
 *
 * In gateway mode the request's headers are read from ctx.requestInfo,
 * keeping credentials bound per request. Missing headers are answered 401 by
 * the HTTP layer BEFORE serving ever starts — the factory itself never
 * throws (a throwing factory would surface as a 500).
 */
export function makeMcpServerFactory(options: { gatewayMode: boolean }): McpServerFactory {
  return (ctx) => {
    if (options.gatewayMode) {
      const { creds } = resolveGatewayCredentials(
        (name) => ctx.requestInfo?.headers.get(name) ?? undefined
      );
      return createMcpServer(creds);
    }
    const { creds } = resolveEnvCredentials();
    return createMcpServer(creds);
  };
}

// ── Pure request-handler bodies (exported for tests) ───────────────────────

export function listToolsResult(): { tools: typeof TOOLS } {
  // By reference, never rebuilt/sorted/filtered — deterministic for every caller.
  return { tools: TOOLS };
}

export function listResourcesResult() {
  return {
    resources: [
      {
        uri: CARD_RESOURCE_URI,
        name: "ConnectWise CPQ Quote Card",
        description: "MCP Apps card rendering a ConnectWise CPQ quote (read-only)",
        mimeType: MCP_APP_RESOURCE_MIME,
      },
    ],
  };
}

export function readResourceResult(uri: string) {
  if (uri !== CARD_RESOURCE_URI) {
    throw new Error(`Unknown resource: ${uri}`);
  }
  return {
    contents: [
      {
        uri,
        mimeType: MCP_APP_RESOURCE_MIME,
        // Ships neutral; operators brand at serve time via MCP_BRAND_* env vars.
        text: applyBrandInjection(QUOTE_CARD_HTML, resolveBrandFromEnv()),
      },
    ],
  };
}

/**
 * Create a fresh MCP server. Called once for stdio, per-request for HTTP.
 * Credentials may be absent (e.g. env mode without vars): `tools/list` still
 * serves the full deterministic surface; `tools/call` answers a clear
 * isError result instead of throwing.
 */
export function createMcpServer(credentials?: CpqCredentials): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {} } }
  );
  setServerRef(server);

  let client: CpqClient | undefined;

  server.setRequestHandler("tools/list", async () => listToolsResult());
  server.setRequestHandler("resources/list", async () => listResourcesResult());
  server.setRequestHandler("resources/read", async (request) =>
    readResourceResult(request.params.uri)
  );

  server.setRequestHandler("tools/call", async (request) => {
    const { name, arguments: args } = request.params;
    logger.debug("Tool call received", { tool: name });

    if (!credentials) {
      return errorResult(
        "Missing ConnectWise CPQ credentials. Set CPQ_ACCESS_KEY, CPQ_PUBLIC_KEY, and " +
          "CPQ_PRIVATE_KEY (env mode) or send the X-CPQ-Access-Key / X-CPQ-Public-Key / " +
          "X-CPQ-Private-Key gateway headers."
      );
    }
    try {
      client ??= new CpqClient(credentials);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResult(`Invalid ConnectWise CPQ credentials: ${message}`);
    }

    return handleToolCall(client, name, (args ?? {}) as Record<string, unknown>);
  });

  return server;
}
