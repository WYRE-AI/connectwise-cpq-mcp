#!/usr/bin/env node
/**
 * ConnectWise CPQ (Sell) MCP server — flat 25-tool surface.
 *
 * Transports:
 * - stdio (default): local Claude Desktop / CLI usage. `serveStdio` owns the
 *   era decision: a 2025-era `initialize` pins the connection legacy; modern
 *   2026-07-28 envelope openings are served natively.
 * - http: hosted deployment. `createMcpHandler({ legacy: 'stateless' })` is
 *   the dual-era posture — 2025-era traffic answered per-request statelessly,
 *   modern envelope traffic natively. NEVER `legacy: 'reject'`.
 *
 * Credentials via environment variables (env mode):
 * - CPQ_ACCESS_KEY / CPQ_PUBLIC_KEY / CPQ_PRIVATE_KEY
 * Or via gateway headers (AUTH_MODE=gateway):
 * - X-CPQ-Access-Key / X-CPQ-Public-Key / X-CPQ-Private-Key
 *
 * HTTP transport refuses to start unless CONDUIT_S2S_SECRET is a real secret.
 * Known placeholders are rejected even when MCP_ALLOW_INSECURE_DEV=1.
 * That flag is local-only: it logs a warning, skips X-Gateway-S2S, and
 * listens on 127.0.0.1 only. A configured secret honors MCP_HTTP_HOST.
 * The listen address defaults to 127.0.0.1 when MCP_HTTP_HOST is unset.
 * /health and /healthz stay unauthenticated and do not read credentials.
 * stdio does not use S2S auth.
 */
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  GATEWAY_HEADERS,
  SERVER_VERSION,
  createMcpServer,
  makeMcpServerFactory,
  resolveEnvCredentials,
  resolveGatewayCredentials,
} from "./mcp-server.js";
import { logger } from "./utils/logger.js";
import { verifyS2sHeader, S2S_HEADER } from "./s2s-verify.js";

/**
 * Public example values. A copied placeholder must not verify as a real
 * secret, and it is not a substitute for leaving CONDUIT_S2S_SECRET unset.
 */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  "replace-with-a-real-secret",
  "your-s2s-secret",
  "your-secret",
  "changeme",
  "change-me",
  "placeholder",
  "secret",
  "example",
  "replace-me",
  "s2s-secret",
]);

const LOOPBACK_HOST = "127.0.0.1";

const MISSING_S2S_SECRET_ERROR =
  "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is empty. " +
  "Set CONDUIT_S2S_SECRET, or set MCP_ALLOW_INSECURE_DEV=1 for local development only.";

const PLACEHOLDER_S2S_SECRET_ERROR =
  "Refusing to start HTTP transport: CONDUIT_S2S_SECRET is a known placeholder. " +
  "Generate a secret with `openssl rand -hex 32` and set CONDUIT_S2S_SECRET to that value.";

const INSECURE_DEV_WARNING =
  "SECURITY WARNING: CONDUIT_S2S_SECRET is empty and MCP_ALLOW_INSECURE_DEV=1. " +
  "HTTP /mcp is not enforcing X-Gateway-S2S and listens on 127.0.0.1 only. " +
  "Do not use this outside local development.";

/** Hosts that count as loopback when deciding whether to log a bind override. */
function isLoopbackBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.+)\]$/, "$1");
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1";
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (Array.isArray(value)) return value.find((item) => item.length > 0);
  return undefined;
}

/**
 * Secret for X-Gateway-S2S on /mcp. Read at HTTP startup, not module load.
 * Empty is fail-closed unless MCP_ALLOW_INSECURE_DEV=1. A known placeholder
 * always refuses to start. The secret value is never written to logs.
 */
function resolveHttpS2sSecret(): string {
  const secret = (process.env.CONDUIT_S2S_SECRET ?? "").trim();
  if (KNOWN_PLACEHOLDER_SECRETS.has(secret.toLowerCase())) {
    logger.error(PLACEHOLDER_S2S_SECRET_ERROR);
    process.exit(1);
  }
  if (secret) return secret;

  if (process.env.MCP_ALLOW_INSECURE_DEV === "1") {
    // error level so LOG_LEVEL=warn|error cannot hide the bypass.
    logger.error(INSECURE_DEV_WARNING);
    return "";
  }

  logger.error(MISSING_S2S_SECRET_ERROR);
  process.exit(1);
}

/**
 * No real secret (the insecure-dev bypass) always binds 127.0.0.1, even when
 * MCP_HTTP_HOST is a wider address such as 0.0.0.0. A configured secret
 * honors MCP_HTTP_HOST. Unset MCP_HTTP_HOST binds 127.0.0.1.
 */
function resolveBindHost(s2sSecret: string): string {
  const configured = (process.env.MCP_HTTP_HOST ?? "").trim();
  if (s2sSecret) return configured || LOOPBACK_HOST;
  if (configured && !isLoopbackBindHost(configured)) {
    logger.error(
      `WARNING: MCP_HTTP_HOST=${configured} is not a loopback address. ` +
        "MCP_ALLOW_INSECURE_DEV=1 without CONDUIT_S2S_SECRET cannot listen there. " +
        `Binding ${LOOPBACK_HOST} only.`
    );
  }
  return LOOPBACK_HOST;
}

const CORS_ALLOW_HEADERS = [
  "Content-Type",
  "Accept",
  "Authorization",
  "Mcp-Session-Id",
  "Mcp-Protocol-Version",
  ...GATEWAY_HEADERS,
].join(", ");

/** stdio (default). Fresh server per process; env-mode credentials. */
function startStdioTransport(): void {
  serveStdio(() => createMcpServer(resolveEnvCredentials().creds), {
    onerror: (error) => logger.error("stdio serving error", { error: error.message }),
  });
  logger.info("ConnectWise CPQ MCP server running on stdio");
}

export async function startHttpTransport(): Promise<HttpServer> {
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const s2sSecret = resolveHttpS2sSecret();
  const host = resolveBindHost(s2sSecret);
  const isGatewayMode = process.env.AUTH_MODE === "gateway";

  const mcpHandler = createMcpHandler(makeMcpServerFactory({ gatewayMode: isGatewayMode }), {
    legacy: "stateless",
    onerror: (error) => logger.error("MCP serving error", { error: error.message }),
  });
  const handleMcpRequest = toNodeHandler(mcpHandler, {
    onerror: (error) => logger.error("MCP request adapter error", { error: error.message }),
  });

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS for claude.ai custom connectors — set on every response, before routing.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
    res.setHeader("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
    res.setHeader("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // Health endpoint — shallow, unauthenticated liveness probe. Must NOT
    // touch credentials or any upstream: in gateway mode credentials only
    // arrive per-request via headers, so a credential check here would
    // always fail and crash-loop the container. This handler does not
    // read vendor credentials or the S2S secret.
    if (url.pathname === "/health" || url.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          version: SERVER_VERSION,
          mcpTransport: "http",
          authMode: isGatewayMode ? "gateway" : "env",
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    // Empty s2sSecret is only reachable when MCP_ALLOW_INSECURE_DEV=1;
    // startup refuses otherwise. A configured secret is always enforced.
    if (s2sSecret && !verifyS2sHeader(headerValue(req.headers[S2S_HEADER]), s2sSecret)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.",
        })
      );
      return;
    }

    if (url.pathname === "/mcp") {
      // 401 gate: reject unauthenticated gateway traffic BEFORE serving —
      // falling through to env-configured credentials would serve the
      // operator's tenant data to whoever asked (cross-tenant leak).
      if (isGatewayMode) {
        const { error } = resolveGatewayCredentials((name) => headerValue(req.headers[name]));
        if (error) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: {
                code: -32001,
                message: `Unauthorized: ${error}`,
                data: { required: GATEWAY_HEADERS },
              },
              id: null,
            })
          );
          return;
        }
      }

      // Per-request credential binding happens inside the factory (it reads
      // the gateway headers from ctx.requestInfo on every request).
      await handleMcpRequest(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", endpoints: ["/mcp", "/health"] }));
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.removeListener("error", reject);
      logger.info(`ConnectWise CPQ MCP server listening on http://${host}:${port}/mcp`);
      logger.info(`Health check available at http://${host}:${port}/health`);
      logger.info(`Authentication mode: ${isGatewayMode ? "gateway (header-based)" : "env"}`);
      resolve();
    });
  });

  if (process.env.VITEST === "true") {
    httpServer.on("close", () => {
      void mcpHandler.close();
    });
  } else {
    const shutdown = async () => {
      logger.info("Shutting down ConnectWise CPQ MCP server...");
      await mcpHandler.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  return httpServer;
}

async function main() {
  const transportType = process.env.MCP_TRANSPORT || "stdio";
  logger.info("Starting ConnectWise CPQ MCP server", {
    transport: transportType,
    nodeVersion: process.version,
  });

  if (transportType === "http") {
    await startHttpTransport();
  } else {
    startStdioTransport();
  }
}

// Vitest imports this module to call startHttpTransport. Skip the CLI
// entrypoint there. `node dist/index.js` still starts stdio or HTTP.
if (process.env.VITEST !== "true") {
  main().catch((error) => {
    logger.error("Fatal startup error", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
