/** Credential resolution + stateless tool-list invariants. */
import { describe, expect, it } from "vitest";
import {
  buildCredentials,
  createMcpServer,
  GATEWAY_HEADERS,
  listResourcesResult,
  listToolsResult,
  makeMcpServerFactory,
  readResourceResult,
  resolveEnvCredentials,
  resolveGatewayCredentials,
} from "../mcp-server.js";
import { CARD_RESOURCE_URI, MCP_APP_RESOURCE_MIME } from "../card.builder.js";
import { TOOLS } from "../tools.js";

describe("buildCredentials", () => {
  it("accepts all three parts", () => {
    const { creds, error } = buildCredentials("a", "b", "c");
    expect(error).toBeUndefined();
    expect(creds).toEqual({ accessKey: "a", publicKey: "b", privateKey: "c" });
  });

  it("names every missing header", () => {
    const { creds, error } = buildCredentials(undefined, "b", undefined);
    expect(creds).toBeUndefined();
    expect(error).toContain("X-CPQ-Access-Key");
    expect(error).toContain("X-CPQ-Private-Key");
    expect(error).not.toContain("X-CPQ-Public-Key,");
  });

  it("rejects when everything is missing", () => {
    const { error } = buildCredentials(undefined, undefined, undefined);
    for (const header of GATEWAY_HEADERS) expect(error).toContain(header);
  });
});

describe("resolveGatewayCredentials", () => {
  it("reads the exact lowercased x-cpq-* headers", () => {
    const headers: Record<string, string> = {
      "x-cpq-access-key": "ak",
      "x-cpq-public-key": "pk",
      "x-cpq-private-key": "sk",
    };
    const seen: string[] = [];
    const { creds } = resolveGatewayCredentials((name) => {
      seen.push(name);
      return headers[name];
    });
    expect(creds).toEqual({ accessKey: "ak", publicKey: "pk", privateKey: "sk" });
    expect(seen).toEqual(["x-cpq-access-key", "x-cpq-public-key", "x-cpq-private-key"]);
  });

  it("errors when any header is absent", () => {
    const { error } = resolveGatewayCredentials((name) =>
      name === "x-cpq-access-key" ? "ak" : undefined
    );
    expect(error).toBeTruthy();
  });
});

describe("resolveEnvCredentials", () => {
  it("reads CPQ_* env vars", () => {
    const { creds } = resolveEnvCredentials({
      CPQ_ACCESS_KEY: "ak",
      CPQ_PUBLIC_KEY: "pk",
      CPQ_PRIVATE_KEY: "sk",
    });
    expect(creds).toEqual({ accessKey: "ak", publicKey: "pk", privateKey: "sk" });
  });
});

describe("stateless tool surface", () => {
  it("returns the module-scope TOOLS array by reference every time", () => {
    expect(listToolsResult().tools).toBe(TOOLS);
    expect(listToolsResult().tools).toBe(listToolsResult().tools);
  });

  it("is identical (same order) regardless of credentials", () => {
    // The list never varies by caller — createMcpServer with and without
    // credentials serves the same reference.
    createMcpServer();
    const withoutCreds = listToolsResult().tools.map((t) => t.name);
    createMcpServer({ accessKey: "a", publicKey: "b", privateKey: "c" });
    const withCreds = listToolsResult().tools.map((t) => t.name);
    expect(withoutCreds).toEqual(withCreds);
  });
});

describe("MCP Apps resource handlers", () => {
  it("lists exactly the quote card resource", () => {
    const { resources } = listResourcesResult();
    expect(resources).toHaveLength(1);
    expect(resources[0].uri).toBe(CARD_RESOURCE_URI);
    expect(resources[0].mimeType).toBe(MCP_APP_RESOURCE_MIME);
  });

  it("reads the card HTML back with the MCP Apps MIME", () => {
    const { contents } = readResourceResult(CARD_RESOURCE_URI);
    expect(contents[0].mimeType).toBe(MCP_APP_RESOURCE_MIME);
    expect(contents[0].text).toContain("<!doctype html>");
  });

  it("throws on unknown resource URIs", () => {
    expect(() => readResourceResult("ui://other/nope.html")).toThrow(/Unknown resource/);
  });
});

describe("makeMcpServerFactory", () => {
  it("builds a server from gateway headers per request", () => {
    const factory = makeMcpServerFactory({ gatewayMode: true });
    const headers = new Map<string, string>([
      ["x-cpq-access-key", "ak"],
      ["x-cpq-public-key", "pk"],
      ["x-cpq-private-key", "sk"],
    ]);
    const server = factory({
      requestInfo: { headers: { get: (n: string) => headers.get(n) ?? null } },
    } as never);
    expect(server).toBeTruthy();
  });

  it("never throws even with no credentials (401 gate lives in the HTTP layer)", () => {
    const factory = makeMcpServerFactory({ gatewayMode: true });
    expect(() =>
      factory({
        requestInfo: { headers: { get: () => null } },
      } as never)
    ).not.toThrow();
  });
});
