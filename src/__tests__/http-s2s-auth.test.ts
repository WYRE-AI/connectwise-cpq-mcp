/**
 * HTTP transport fail-closed auth.
 *
 * Startup requires a real CONDUIT_S2S_SECRET unless MCP_ALLOW_INSECURE_DEV=1.
 * Known placeholders are refused even with that flag. The flag binds
 * 127.0.0.1 only. /mcp rejects a missing or invalid X-Gateway-S2S header.
 * AUTH_MODE=gateway rejects requests that omit vendor credential headers
 * and must not fall back to CPQ_* in process.env.
 */
import { createHmac } from "node:crypto";
import { request as httpRequest, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const credsSink = vi.hoisted(() => ({
  calls: [] as Array<{ accessKey: string; publicKey: string; privateKey: string }>,
}));

vi.mock("@wyre-technology/node-connectwise-cpq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wyre-technology/node-connectwise-cpq")>();
  return {
    ...actual,
    CpqClient: class {
      users = { list: async () => [] };
      constructor(creds: { accessKey: string; publicKey: string; privateKey: string }) {
        credsSink.calls.push(creds);
      }
    },
  };
});

import { startHttpTransport } from "../index.js";

const S2S_SECRET = "s2s-do-not-log-7f3a";
const ENV_ACCESS_KEY = "env-access-key-must-not-be-used";
const ENV_PUBLIC_KEY = "env-public-key-must-not-be-used";
const ENV_PRIVATE_KEY = "env-private-key-must-not-be-used";
const HEADER_ACCESS_KEY = "header-access-key";
const HEADER_PUBLIC_KEY = "header-public-key";
const HEADER_PRIVATE_KEY = "header-private-key";

const ENV_KEYS = [
  "CONDUIT_S2S_SECRET",
  "MCP_ALLOW_INSECURE_DEV",
  "MCP_HTTP_PORT",
  "MCP_HTTP_HOST",
  "AUTH_MODE",
  "CPQ_ACCESS_KEY",
  "CPQ_PUBLIC_KEY",
  "CPQ_PRIVATE_KEY",
  "LOG_LEVEL",
  "MCP_TRANSPORT",
] as const;

const savedEnv = new Map<string, string | undefined>();
const servers: HttpServer[] = [];

function mintS2sHeader(secret: string, unixSeconds = Math.floor(Date.now() / 1000)): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac("sha256", secret).update(message).digest("hex");
  return `${message},v1=${hex}`;
}

function captureStderr(): { text: () => string; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8"));
    return true;
  });
  return {
    text: () => lines.join(""),
    restore: () => spy.mockRestore(),
  };
}

function exitSpy() {
  return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${String(code)}`);
  }) as typeof process.exit);
}

interface HttpResult {
  status: number;
  body: string;
}

function sendHttp(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: options.port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.setTimeout(5000, () => {
      req.destroy(new Error(`timeout ${options.method} ${options.path}`));
    });
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

async function listen(): Promise<{ port: number; address: string; server: HttpServer }> {
  const server = await startHttpTransport();
  servers.push(server);
  const bound = server.address() as AddressInfo | null;
  if (!bound || typeof bound === "string") {
    throw new Error("HTTP server did not bind a TCP port");
  }
  return { port: bound.port, address: bound.address, server };
}

function mcpHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...extra,
  };
}

function parseMcpBody(body: string): {
  result?: { content?: Array<{ text?: string }> };
  error?: { code?: number; message?: string };
} {
  const dataLines = body.split("\n").filter((line) => line.startsWith("data:"));
  const payload = dataLines.length > 0 ? dataLines[dataLines.length - 1].slice("data:".length).trim() : body;
  return JSON.parse(payload) as {
    result?: { content?: Array<{ text?: string }> };
    error?: { code?: number; message?: string };
  };
}

const statusCall = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "cpq_test_connection", arguments: {} },
});

beforeAll(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  process.env.MCP_HTTP_PORT = "0";
  process.env.MCP_HTTP_HOST = "127.0.0.1";
  process.env.LOG_LEVEL = "error";
  delete process.env.CONDUIT_S2S_SECRET;
  delete process.env.MCP_ALLOW_INSECURE_DEV;
  delete process.env.AUTH_MODE;
  delete process.env.CPQ_ACCESS_KEY;
  delete process.env.CPQ_PUBLIC_KEY;
  delete process.env.CPQ_PRIVATE_KEY;
  credsSink.calls.length = 0;
});

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (!server?.listening) continue;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

describe("HTTP startup", () => {
  it("refuses to start when CONDUIT_S2S_SECRET is empty", async () => {
    const logs = captureStderr();
    const exit = exitSpy();
    try {
      await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
      expect(exit).toHaveBeenCalledWith(1);
      const text = logs.text();
      expect(text).toContain("Refusing to start HTTP transport");
      expect(text).toContain("CONDUIT_S2S_SECRET is empty");
      expect(text).toContain("MCP_ALLOW_INSECURE_DEV=1");
      expect(text).not.toContain(S2S_SECRET);
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it("still refuses when MCP_ALLOW_INSECURE_DEV is not exactly 1", async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = "true";
    const logs = captureStderr();
    const exit = exitSpy();
    try {
      await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
      expect(logs.text()).toContain("Refusing to start HTTP transport");
      expect(logs.text()).not.toContain(S2S_SECRET);
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it("allows startup with a warning when MCP_ALLOW_INSECURE_DEV=1", async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = "1";
    delete process.env.MCP_HTTP_HOST;
    const logs = captureStderr();
    try {
      const server = await listen();
      expect(server.address).toBe("127.0.0.1");
      const text = logs.text();
      expect(text).toContain("SECURITY WARNING");
      expect(text).toContain("CONDUIT_S2S_SECRET");
      expect(text).toContain("MCP_ALLOW_INSECURE_DEV=1");
      expect(text).toContain("127.0.0.1");
      expect(text).not.toContain("not a loopback address");
      expect(text).not.toContain(S2S_SECRET);
    } finally {
      logs.restore();
    }
  });

  it("binds 127.0.0.1 when the dev bypass is set and MCP_HTTP_HOST is non-loopback", async () => {
    process.env.MCP_ALLOW_INSECURE_DEV = "1";
    process.env.MCP_HTTP_HOST = "0.0.0.0";
    const logs = captureStderr();
    const exit = exitSpy();
    try {
      const server = await listen();
      expect(exit).not.toHaveBeenCalled();
      expect(server.address).toBe("127.0.0.1");
      const text = logs.text();
      expect(text).toContain("MCP_HTTP_HOST=0.0.0.0 is not a loopback address");
      expect(text).toContain("Binding 127.0.0.1 only");
      expect(text).not.toContain(S2S_SECRET);
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it("refuses a known placeholder secret and does not log it", async () => {
    process.env.CONDUIT_S2S_SECRET = "replace-with-a-real-secret";
    const logs = captureStderr();
    const exit = exitSpy();
    try {
      await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
      expect(exit).toHaveBeenCalledWith(1);
      const text = logs.text();
      expect(text).toContain("known placeholder");
      expect(text).toContain("openssl rand -hex 32");
      expect(text).not.toContain("replace-with-a-real-secret");
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it("refuses a placeholder even when MCP_ALLOW_INSECURE_DEV=1", async () => {
    process.env.CONDUIT_S2S_SECRET = "  Your-S2S-Secret  ";
    process.env.MCP_ALLOW_INSECURE_DEV = "1";
    const logs = captureStderr();
    const exit = exitSpy();
    try {
      await expect(startHttpTransport()).rejects.toThrow("process.exit:1");
      const text = logs.text();
      expect(text).toContain("known placeholder");
      expect(text).not.toContain("Your-S2S-Secret");
      expect(text).not.toContain("SECURITY WARNING");
    } finally {
      exit.mockRestore();
      logs.restore();
    }
  });

  it("still binds a non-loopback host when CONDUIT_S2S_SECRET is set", async () => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.MCP_HTTP_HOST = "0.0.0.0";
    const logs = captureStderr();
    try {
      const server = await listen();
      expect(server.address).toBe("0.0.0.0");
      expect(logs.text()).not.toContain("not a loopback address");
      expect(logs.text()).not.toContain(S2S_SECRET);
    } finally {
      logs.restore();
    }
  });

  it("binds 127.0.0.1 when MCP_HTTP_HOST is unset and a secret is set", async () => {
    delete process.env.MCP_HTTP_HOST;
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    const server = await listen();
    expect(server.address).toBe("127.0.0.1");
  });
});

describe("HTTP /mcp authentication", () => {
  beforeEach(() => {
    process.env.CONDUIT_S2S_SECRET = S2S_SECRET;
    process.env.AUTH_MODE = "gateway";
    process.env.CPQ_ACCESS_KEY = ENV_ACCESS_KEY;
    process.env.CPQ_PUBLIC_KEY = ENV_PUBLIC_KEY;
    process.env.CPQ_PRIVATE_KEY = ENV_PRIVATE_KEY;
  });

  it("returns 401 when the S2S header is missing or invalid and does not log the secret", async () => {
    const logs = captureStderr();
    try {
      const server = await listen();
      const missing = await sendHttp({
        port: server.port,
        method: "POST",
        path: "/mcp",
        headers: mcpHeaders({
          "x-cpq-access-key": HEADER_ACCESS_KEY,
          "x-cpq-public-key": HEADER_PUBLIC_KEY,
          "x-cpq-private-key": HEADER_PRIVATE_KEY,
        }),
        body: statusCall,
      });
      const invalid = await sendHttp({
        port: server.port,
        method: "POST",
        path: "/mcp",
        headers: mcpHeaders({
          "x-gateway-s2s": mintS2sHeader("wrong-secret"),
          "x-cpq-access-key": HEADER_ACCESS_KEY,
          "x-cpq-public-key": HEADER_PUBLIC_KEY,
          "x-cpq-private-key": HEADER_PRIVATE_KEY,
        }),
        body: statusCall,
      });

      expect(missing.status).toBe(401);
      expect(invalid.status).toBe(401);
      expect(missing.body).toContain("X-Gateway-S2S");
      expect(invalid.body).toContain("X-Gateway-S2S");
      expect(missing.body).not.toContain(S2S_SECRET);
      expect(invalid.body).not.toContain(S2S_SECRET);
      expect(missing.body).not.toContain(ENV_PRIVATE_KEY);
      expect(invalid.body).not.toContain(HEADER_PRIVATE_KEY);
      expect(logs.text()).not.toContain(S2S_SECRET);
      expect(credsSink.calls).toHaveLength(0);
    } finally {
      logs.restore();
    }
  });

  it("returns 401 in gateway mode without credential headers and does not use env credentials", async () => {
    const server = await listen();
    const response = await sendHttp({
      port: server.port,
      method: "POST",
      path: "/mcp",
      headers: mcpHeaders({ "x-gateway-s2s": mintS2sHeader(S2S_SECRET) }),
      body: statusCall,
    });

    expect(response.status).toBe(401);
    const body = JSON.parse(response.body) as {
      jsonrpc?: string;
      error?: { code?: number; message?: string; data?: { required?: string[] } };
    };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error?.code).toBe(-32001);
    expect(body.error?.message).toContain("Missing credentials");
    expect(body.error?.message).toContain("X-CPQ-Access-Key");
    expect(body.error?.message).toContain("X-CPQ-Public-Key");
    expect(body.error?.message).toContain("X-CPQ-Private-Key");
    expect(body.error?.data?.required).toEqual([
      "X-CPQ-Access-Key",
      "X-CPQ-Public-Key",
      "X-CPQ-Private-Key",
    ]);
    expect(response.body).not.toContain(ENV_ACCESS_KEY);
    expect(response.body).not.toContain(ENV_PRIVATE_KEY);
    expect(response.body).not.toContain(S2S_SECRET);
    expect(credsSink.calls).toHaveLength(0);

    const partial = await sendHttp({
      port: server.port,
      method: "POST",
      path: "/mcp",
      headers: mcpHeaders({
        "x-gateway-s2s": mintS2sHeader(S2S_SECRET),
        "x-cpq-access-key": HEADER_ACCESS_KEY,
        "x-cpq-public-key": HEADER_PUBLIC_KEY,
      }),
      body: statusCall,
    });
    expect(partial.status).toBe(401);
    expect(partial.body).not.toContain(HEADER_ACCESS_KEY);
    expect(partial.body).not.toContain(ENV_PRIVATE_KEY);
    expect(credsSink.calls).toHaveLength(0);
  });

  it("accepts a valid S2S header plus credential headers and uses those credentials", async () => {
    const logs = captureStderr();
    try {
      const server = await listen();
      const response = await sendHttp({
        port: server.port,
        method: "POST",
        path: "/mcp",
        headers: mcpHeaders({
          "x-gateway-s2s": mintS2sHeader(S2S_SECRET),
          "x-cpq-access-key": HEADER_ACCESS_KEY,
          "x-cpq-public-key": HEADER_PUBLIC_KEY,
          "x-cpq-private-key": HEADER_PRIVATE_KEY,
        }),
        body: statusCall,
      });

      expect(response.status).toBe(200);
      const payload = parseMcpBody(response.body);
      const text = payload.result?.content?.[0]?.text ?? "";
      const status = JSON.parse(text) as { ok?: boolean };
      expect(status.ok).toBe(true);
      expect(response.body).not.toContain(S2S_SECRET);
      expect(response.body).not.toContain(ENV_ACCESS_KEY);
      expect(response.body).not.toContain(ENV_PRIVATE_KEY);
      expect(response.body).not.toContain(HEADER_PRIVATE_KEY);
      expect(logs.text()).not.toContain(S2S_SECRET);
      expect(credsSink.calls).toEqual([
        {
          accessKey: HEADER_ACCESS_KEY,
          publicKey: HEADER_PUBLIC_KEY,
          privateKey: HEADER_PRIVATE_KEY,
        },
      ]);
    } finally {
      logs.restore();
    }
  });

  it("serves /health and /healthz without authentication and without reading credentials", async () => {
    const server = await listen();
    for (const path of ["/health", "/healthz"]) {
      const response = await sendHttp({ port: server.port, method: "GET", path });
      expect(response.status).toBe(200);
      const body = JSON.parse(response.body) as { status?: string; authMode?: string; credentials?: unknown };
      expect(body.status).toBe("ok");
      expect(body.authMode).toBe("gateway");
      expect(body.credentials).toBeUndefined();
      expect(response.body).not.toContain(S2S_SECRET);
      expect(response.body).not.toContain(ENV_ACCESS_KEY);
      expect(response.body).not.toContain(ENV_PRIVATE_KEY);
    }
    expect(credsSink.calls).toHaveLength(0);
  });
});
