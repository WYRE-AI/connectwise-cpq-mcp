/**
 * End-to-end elicitation over the REAL serving stack: the same
 * createMcpHandler({ legacy: 'stateless' }) + toNodeHandler wiring as
 * src/index.ts, with only the vendor CpqClient stubbed.
 *
 * Proves the MRTR seam on both protocol eras:
 * - a 2026-07-28 client with the elicitation capability gets the delete
 *   confirmation as an embedded `elicitation/create` request (auto-fulfilled
 *   by the v2 client) — decline cancels the DELETE, accept lets it fire;
 * - a stateless 2025-era caller (no capability view) — how the WYRE Conduit
 *   gateway connects — cannot be prompted, so the DELETE is BLOCKED unless the
 *   request carries an explicit `confirm_destructive_action`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";

const { quotesApi } = vi.hoisted(() => ({
  quotesApi: {
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@wyre-technology/node-connectwise-cpq", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@wyre-technology/node-connectwise-cpq")>();
  return {
    ...actual,
    CpqClient: class {
      quotes = quotesApi;
      quoteItems = { list: vi.fn().mockResolvedValue([{ id: "qi-1" }]) };
    },
  };
});

const { makeMcpServerFactory } = await import("../mcp-server.js");

const ENV_KEYS = ["CPQ_ACCESS_KEY", "CPQ_PUBLIC_KEY", "CPQ_PRIVATE_KEY"] as const;

describe("elicitation over the live dual-era serving stack", () => {
  let mcpHandler: McpHttpHandler;
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    for (const key of ENV_KEYS) process.env[key] = "test-value";
    mcpHandler = createMcpHandler(makeMcpServerFactory({ gatewayMode: false }), {
      legacy: "stateless",
    });
    const handleMcp = toNodeHandler(mcpHandler);
    server = http.createServer((req, res) => {
      void handleMcp(req as unknown as Parameters<typeof handleMcp>[0], res);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    for (const key of ENV_KEYS) delete process.env[key];
    await mcpHandler.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function modernDelete(confirm: boolean): Promise<{ prompts: string[]; text: string }> {
    const { Client, StreamableHTTPClientTransport } = await import(
      "@modelcontextprotocol/client"
    );
    const prompts: string[] = [];
    const client = new Client(
      { name: "elicit-e2e", version: "0.0.0" },
      {
        capabilities: { elicitation: {} },
        // Negotiate the modern era — the default is a plain 2025 connect.
        versionNegotiation: { mode: "auto" },
      }
    );
    client.setRequestHandler("elicitation/create", async (request) => {
      prompts.push(request.params.message);
      return { action: "accept" as const, content: { confirm } };
    });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    try {
      const result = await client.callTool({
        name: "cpq_delete_quote",
        arguments: { id: "q-1" },
      });
      const content = result.content as Array<{ type: string; text?: string }>;
      return { prompts, text: content[0]?.text ?? "" };
    } finally {
      await client.close();
    }
  }

  it("2026-07-28 era: declined confirmation cancels the DELETE", async () => {
    quotesApi.get.mockResolvedValue({ id: "q-1", name: "Quote A", quoteNumber: 7 });
    quotesApi.delete.mockResolvedValue(undefined);

    const { prompts, text } = await modernDelete(false);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Permanently delete");
    expect(prompts[0]).toContain("Quote A");
    expect(text).toContain("NOT deleted");
    expect(quotesApi.delete).not.toHaveBeenCalled();
  });

  it("2026-07-28 era: accepted confirmation lets the DELETE fire", async () => {
    quotesApi.delete.mockClear();

    const { prompts, text } = await modernDelete(true);
    expect(prompts).toHaveLength(1);
    expect(quotesApi.delete).toHaveBeenCalledWith("q-1");
    expect(JSON.parse(text).deleted).toBe(true);
  });

  /** One stateless 2025-era tools/call — no initialize, so no capability view. */
  async function statelessDelete(
    args: Record<string, unknown>
  ): Promise<{ isError?: boolean; text: string }> {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "cpq_delete_quote", arguments: args },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const dataLines = text.split("\n").filter((line) => line.startsWith("data:"));
    const message = JSON.parse(
      (dataLines.length > 0 ? dataLines[dataLines.length - 1].slice(5) : text).trim()
    );
    return {
      isError: message.result?.isError,
      text: message.result?.content?.[0]?.text ?? "",
    };
  }

  it("stateless 2025-era caller: no capability view → the DELETE is blocked, not assumed", async () => {
    quotesApi.delete.mockClear();

    const { isError, text } = await statelessDelete({ id: "q-1" });
    expect(isError).toBe(true);
    expect(text).toContain("confirm_destructive_action");
    expect(quotesApi.delete).not.toHaveBeenCalled();
  });

  it("stateless 2025-era caller: explicit confirmation lets the DELETE fire", async () => {
    quotesApi.delete.mockClear();

    const { text } = await statelessDelete({ id: "q-1", confirm_destructive_action: true });
    expect(JSON.parse(text).deleted).toBe(true);
    expect(quotesApi.delete).toHaveBeenCalledWith("q-1");
  });
});
